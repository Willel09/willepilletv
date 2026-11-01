import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseM3u, hash } from './m3u.ts'
import { parseXmltv, parseXmltvTime, matchEpg, normName, XmltvParser } from './epg.ts'

test('parseM3u splits live, movies and series', () => {
  const m3u = `#EXTM3U url-tvg="http://epg.example/guide.xml.gz"
#EXTINF:-1 tvg-id="bbc1.uk" tvg-logo="http://l/bbc.png" group-title="UK, News" tvg-chno="101",BBC One, HD
http://host/live/u/p/1.ts
#EXTINF:-1 group-title="Films",Some Movie (2020)
http://host/movie/u/p/55.mkv
#EXTINF:-1 group-title="Shows",My Show S01 E02
http://host/series/u/p/77.mp4
#EXTINF:-1 group-title="Shows",My Show S01E01
http://host/series/u/p/76.mp4
#EXTINF:-1,No Group
#EXTGRP:Extra
http://host/stream
`
  const r = parseM3u(m3u, 'src')
  assert.equal(r.epgUrl, 'http://epg.example/guide.xml.gz')
  assert.equal(r.channels.length, 2)
  assert.deepEqual([r.channels[0].name, r.channels[0].group, r.channels[0].epgId, r.channels[0].num], ['BBC One, HD', 'UK, News', 'bbc1.uk', 101])
  assert.equal(r.channels[1].group, 'Extra')
  assert.equal(r.movies.length, 1)
  assert.equal(r.series.length, 1)
  assert.deepEqual(r.series[0].episodes!.map((e) => e.episode), [1, 2])
  assert.equal(r.series[0].name, 'My Show')
})

test('hash is stable and distinct', () => {
  assert.equal(hash('abc'), hash('abc'))
  assert.notEqual(hash('abc'), hash('abd'))
})

test('xmltv time with offsets', () => {
  assert.equal(parseXmltvTime('20240101120000 +0100'), Date.UTC(2024, 0, 1, 11))
  assert.equal(parseXmltvTime('20240101120000'), Date.UTC(2024, 0, 1, 12))
  assert.equal(parseXmltvTime('202401011200 -0230'), Date.UTC(2024, 0, 1, 14, 30))
})

test('parseXmltv + matchEpg by id and by name', () => {
  const xml = `<tv>
<channel id="bbc1.uk"><display-name>BBC One</display-name></channel>
<channel id="x.cnn"><display-name lang="en">CNN International</display-name></channel>
<programme start="20240101120000 +0000" stop="20240101130000 +0000" channel="bbc1.uk"><title lang="en">News &amp; Weather</title><desc>Daily</desc></programme>
<programme channel="x.cnn" stop="20240101130000 +0000" start="20240101120000 +0000"><title>World</title></programme>
<programme start="20230101120000 +0000" stop="20230101130000 +0000" channel="x.cnn"><title>Old</title></programme>
</tv>`
  const d = parseXmltv(xml, Date.UTC(2024, 0, 1), Date.UTC(2024, 0, 2))
  assert.equal(d.programmes.get('bbc1.uk')![0].title, 'News & Weather')
  assert.equal(d.programmes.get('x.cnn')!.length, 1)
  const out = matchEpg(
    [
      { kind: 'live', id: 'a', sourceId: 's', name: 'whatever', group: 'g', url: 'u', epgId: 'BBC1.uk' },
      { kind: 'live', id: 'b', sourceId: 's', name: 'US: CNN International HD', group: 'g', url: 'u' },
      { kind: 'live', id: 'c', sourceId: 's', name: 'Nope', group: 'g', url: 'u' }
    ],
    [d]
  )
  assert.deepEqual(Object.keys(out).sort(), ['a', 'b'])
  assert.equal(normName('|UK| BBC ONE FHD'), 'bbcone')
})

test('descriptions are dropped after descUntil to keep big guides small', () => {
  const xml = `<programme start="20240101120000 +0000" stop="20240101130000 +0000" channel="a"><title>A</title><desc>keep</desc></programme>
<programme start="20240101200000 +0000" stop="20240101210000 +0000" channel="a"><title>B</title><desc>drop</desc></programme>`
  const d = parseXmltv(xml, Date.UTC(2024, 0, 1), Date.UTC(2024, 0, 2), Date.UTC(2024, 0, 1, 15))
  assert.deepEqual(d.programmes.get('a')!.map((p) => p.desc), ['keep', undefined])
})

test('XMLTV parsed in chunks (split mid-tag) equals parsing the whole file', () => {
  const t = (h: number) => `202401011${h}0000 +0000`
  const xml = `<?xml version="1.0"?><tv><channel id="a"><display-name>A &amp; B</display-name></channel><channel id="b"><display-name>B</display-name></channel>` +
    Array.from({ length: 6 }, (_, i) => `<programme start="${t(i)}" stop="${t(i + 1)}" channel="${i % 2 ? 'a' : 'b'}"><title>Show ${i}</title><desc>About ${i}</desc></programme>`).join('\n') + '</tv>'
  const from = Date.UTC(2024, 0, 1), to = from + 2 * 86400_000
  const whole = parseXmltv(xml, from, to)
  for (const size of [1, 7, 33, 100]) {
    const p = new XmltvParser(from, to)
    for (let i = 0; i < xml.length; i += size) p.push(xml.slice(i, i + size))
    const got = p.finish()
    assert.deepEqual([...got.names], [...whole.names], `names, chunk ${size}`)
    assert.deepEqual([...got.programmes], [...whole.programmes], `programmes, chunk ${size}`)
  }
  assert.equal(whole.programmes.get('a')?.length, 3)
  assert.deepEqual(whole.names.get('a'), ['A & B'])
})
