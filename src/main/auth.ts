import { BrowserWindow } from 'electron'
import type { Account, MultipleProfiles } from 'eml-lib'
import EMLLib from 'eml-lib'
import type { AccountPublic, AccountSecret } from '../shared/types'
import type { ConfigStore } from './store'
import { publicAccount } from './store'

type AccountType = AccountPublic['type']

function toSecret(account: Account): AccountSecret {
  return {
    accessToken: account.accessToken,
    clientToken: account.clientToken,
    refreshToken: account.refreshToken,
    userProperties: account.userProperties,
    meta: account.meta,
    xbox: account.xbox
  }
}

function toAccount(publicPart: AccountPublic, secret: AccountSecret): Account {
  return {
    name: publicPart.name,
    uuid: publicPart.uuid,
    accessToken: secret.accessToken,
    clientToken: secret.clientToken,
    refreshToken: secret.refreshToken,
    userProperties: secret.userProperties,
    meta: secret.meta,
    xbox: secret.xbox
  }
}

export class AuthService {
  constructor(
    private store: ConfigStore,
    private getWindow: () => BrowserWindow | null
  ) {}

  activeAccountForRenderer(): AccountPublic | null {
    return this.store.activeAccount()
  }

  accountFor(id?: string): Account | null {    const cfg = this.store.get()
    const accountId = id ?? cfg.activeAccountId
    if (!accountId) return null
    const record = cfg.accounts.find((a) => a.id === accountId)
    if (!record) return null
    const secret = this.store.decryptSecret(record)
    if (!secret) return null
    return toAccount(publicAccount(record), secret)
  }

  loginOffline(username: string): AccountPublic {
    const name = username.trim()
    if (!/^[a-zA-Z0-9_]{3,16}$/.test(name)) {
      throw new Error('离线用户名需要 3–16 位，只能包含字母、数字与下划线')
    }
    const auth = new EMLLib.CrackAuth()
    const account = auth.auth(name)
    return this.store.addAccount(
      { name: account.name, uuid: account.uuid, type: 'crack', online: false },
      toSecret(account)
    )
  }

  async loginMicrosoft(): Promise<AccountPublic> {
    const win = this.getWindow()
    if (!win) throw new Error('主窗口尚未就绪，请稍后再试')
    const auth = new EMLLib.MicrosoftAuth(win)
    const account = await auth.auth()
    return this.store.addAccount(
      { name: account.name, uuid: account.uuid, type: 'msa', online: true },
      toSecret(account)
    )
  }

  async loginYggdrasil(input: {
    url: string
    username: string
    password: string
    profileId?: string
    profileName?: string
  }): Promise<AccountPublic | { needsProfile: true; profiles: { id: string; name: string }[] }> {
    const url = input.url.trim().replace(/\/+$/, '')
    if (!/^https?:\/\//i.test(url)) throw new Error('认证服务器地址需要以 http:// 或 https:// 开头')
    if (!input.username.trim() || !input.password) throw new Error('请填写用户名与密码')
    const auth = new EMLLib.YggdrasilAuth(url)
    const result = await auth.auth(input.username.trim(), input.password)
    if ('needsProfileSelection' in result && result.needsProfileSelection) {
      const profiles = (result as MultipleProfiles).availableProfiles ?? []
      if (!input.profileId && !input.profileName) {
        return { needsProfile: true, profiles: profiles.map((p) => ({ id: p.id, name: p.name })) }
      }
      const account = auth.selectProfile(result as MultipleProfiles, {
        id: input.profileId,
        name: input.profileName
      })
      return this.store.addAccount(
        { name: account.name, uuid: account.uuid, type: 'yggdrasil', online: true },
        toSecret(account)
      )
    }
    const account = result as Account
    return this.store.addAccount(
      { name: account.name, uuid: account.uuid, type: 'yggdrasil', online: true },
      toSecret(account)
    )
  }

  setActive(id: string): AccountPublic | null {
    const cfg = this.store.get()
    const account = cfg.accounts.find((a) => a.id === id)
    if (!account) return null
    this.store.update((c) => {
      c.activeAccountId = id
    })
    return publicAccount(account)
  }

  logout(id: string): void {
    this.store.removeAccount(id)
  }

  /**
   * Validate and, when required, refresh the active session before launching.
   * Offline accounts do not need any network round-trip.
   */
  async ensureFresh(accountId?: string): Promise<Account> {
    const cfg = this.store.get()
    const id = accountId ?? cfg.activeAccountId
    if (!id) throw new Error('请先登录一个账户')
    const record = cfg.accounts.find((a) => a.id === id)
    if (!record) throw new Error('账户不存在')
    const secret = this.store.decryptSecret(record)
    if (!secret) throw new Error('账户凭据已损坏，请重新登录')
    let account = toAccount(publicAccount(record), secret)

    if (record.type === 'msa') {
      const win = this.getWindow()
      if (!win) throw new Error('主窗口尚未就绪')
      const auth = new EMLLib.MicrosoftAuth(win)
      try {
        const valid = await auth.validate(account)
        if (!valid) {
          account = await auth.refresh(account)
          this.store.updateAccountSecret(id, toSecret(account))
          console.log('[auth] refreshed Microsoft session for', account.name)
        }
      } catch (err) {
        console.warn('[auth] Microsoft validation failed:', err)
        throw new Error('Microsoft 登录已过期，请在账户面板重新登录')
      }
    } else if (record.type === 'yggdrasil') {
      const url = secret.meta.url
      if (url) {
        const auth = new EMLLib.YggdrasilAuth(url)
        try {
          const valid = await auth.validate(account)
          if (!valid) {
            account = await auth.refresh(account)
            this.store.updateAccountSecret(id, toSecret(account))
            console.log('[auth] refreshed Yggdrasil session for', account.name)
          }
        } catch {
          throw new Error('第三方账户登录已过期，请在账户面板重新登录')
        }
      }
    }
    return account
  }
}
