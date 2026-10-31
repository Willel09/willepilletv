import type { IptvApi } from '../../shared/types'

declare global {
  interface Window {
    api: IptvApi
  }
}
