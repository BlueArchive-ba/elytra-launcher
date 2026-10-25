import React, { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Check,
  ChevronRight,
  Globe2,
  LogOut,
  ShieldCheck,
  UserRound,
  Wifi,
  WifiOff,
  X
} from 'lucide-react'
import type { AccountPublic } from '@shared/types'
import { errorMessage, useApp } from '../store'
import { Button, classNames, Pill, Spinner } from './ui'

type Tab = 'offline' | 'microsoft' | 'yggdrasil'

function accountHue(name: string): number {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  return Math.abs(hash) % 360
}

function AccountAvatar({ account, size = 46 }: { account: AccountPublic; size?: number }): React.JSX.Element {
  return (
    <span
      className="mini-avatar"
      style={
        {
          width: size,
          height: size,
          '--avatar-h': accountHue(account.name)
        } as React.CSSProperties
      }
    >
      {account.name.slice(0, 1).toUpperCase()}
    </span>
  )
}

export default function AccountDrawer(): React.JSX.Element | null {
  const {
    accountOpen,
    setAccountOpen,
    boot,
    activeAccount,
    loginOffline,
    loginMicrosoft,
    loginYggdrasil,
    setActiveAccount,
    logout,
    pushToast
  } = useApp()
  const [tab, setTab] = useState<Tab>('offline')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [server, setServer] = useState('')
  const [busy, setBusy] = useState(false)
  const [profiles, setProfiles] = useState<{ id: string; name: string }[]>([])
  const [pendingYgg, setPendingYgg] = useState<{ url: string; username: string; password: string } | null>(null)
  const accounts = boot?.config.accounts ?? []

  useEffect(() => {
    if (!accountOpen) {
      setBusy(false)
      setProfiles([])
      setPendingYgg(null)
    }
  }, [accountOpen])

  const run = async (task: () => Promise<unknown>) => {
    if (busy) return
    setBusy(true)
    try {
      await task()
    } catch (err) {
      pushToast({ tone: 'error', title: '账户操作失败', message: errorMessage(err) })
    } finally {
      setBusy(false)
    }
  }

  const submitOffline = () =>
    run(async () => {
      if (!/^[a-zA-Z0-9_]{3,16}$/.test(username.trim())) {
        throw new Error('离线用户名需要 3–16 位，只能包含字母、数字与下划线')
      }
      await loginOffline(username.trim())
      setUsername('')
    })

  const submitMicrosoft = () => run(async () => { await loginMicrosoft() })

  const submitYgg = (profileId?: string) =>
    run(async () => {
      if (!server.trim() || !email.trim() || !password) throw new Error('请填写认证服务器、用户名与密码')
      const result = await loginYggdrasil({
        url: server.trim(),
        username: email.trim(),
        password,
        profileId,
        profileName: profileId ? profiles.find((p) => p.id === profileId)?.name : undefined
      })
      if ('needsProfile' in result) {
        setProfiles(result.profiles)
        setPendingYgg({ url: server.trim(), username: email.trim(), password })
        return
      }
      setEmail('')
      setPassword('')
      setProfiles([])
    })

  const selectAccount = (id: string) => {
    if (id === activeAccount?.id) return
    void run(async () => {
      await setActiveAccount(id)
    })
  }

  const activeInitial = activeAccount?.name.slice(0, 1).toUpperCase() ?? '?'
  const activeHue = accountHue(activeAccount?.name ?? 'EMBER')

  const tabOptions: { id: Tab; label: string; icon: typeof WifiOff }[] = useMemo(
    () => [
      { id: 'offline', label: '离线', icon: WifiOff },
      { id: 'microsoft', label: 'Microsoft', icon: ShieldCheck },
      { id: 'yggdrasil', label: '第三方', icon: Globe2 }
    ],
    []
  )

  if (typeof document === 'undefined') return null

  return createPortal(
    <AnimatePresence>
      {accountOpen ? (
        <motion.div className="drawer-layer" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(e) => e.target === e.currentTarget && setAccountOpen(false)}>
          <motion.aside
            className="account-drawer"
            initial={{ x: 520 }}
            animate={{ x: 0 }}
            exit={{ x: 540 }}
            transition={{ type: 'spring', stiffness: 320, damping: 34 }}
          >
            <div className="drawer-head">
              <div>
                <div className="eyebrow">ACCOUNT // 身份核心</div>
                <h2>你的账户</h2>
              </div>
              <button type="button" className="icon-btn" onClick={() => setAccountOpen(false)} aria-label="关闭">
                <X size={18} />
              </button>
            </div>

            {activeAccount ? (
              <div className="account-hero" style={{ '--avatar-h': activeHue } as React.CSSProperties}>
                <div className="account-hero-glow" />
                <span className="account-hero-avatar">{activeInitial}</span>
                <div className="account-hero-main">
                  <span className="account-hero-label">
                    {activeAccount.online ? <Wifi size={12} /> : <WifiOff size={12} />}
                    {activeAccount.online ? '在线账户' : '离线账户'}
                  </span>
                  <h3>{activeAccount.name}</h3>
                  <p>{activeAccount.type === 'msa' ? 'Microsoft 正版账户' : activeAccount.type === 'yggdrasil' ? '第三方 Yggdrasil 账户' : '离线账户'}</p>
                </div>
                <span className="account-hero-check">
                  <Check size={13} />
                </span>
              </div>
            ) : (
              <div className="account-hero is-empty">
                <span className="account-hero-avatar">?</span>
                <div className="account-hero-main">
                  <span className="account-hero-label">未登录</span>
                  <h3>尚未登录</h3>
                  <p>选择一个认证方式，开始你的世界。</p>
                </div>
              </div>
            )}

            {activeAccount ? (
              <div className="account-hero-actions">
                <span>当前登录：{activeAccount.online ? '在线账户' : '离线账户'}</span>
                <Button
                  variant="ghost"
                  icon={LogOut}
                  disabled={busy}
                  onClick={() => void run(async () => { await logout(activeAccount.id) })}
                >
                  退出登录
                </Button>
              </div>
            ) : null}

            {accounts.length > 1 ? (
              <div className="account-list">
                <div className="drawer-section-label">其他账户</div>
                {accounts
                  .filter((a) => a.id !== activeAccount?.id)
                  .map((account) => (
                    <div key={account.id} className="account-row">
                      <button type="button" className="account-row-main" onClick={() => selectAccount(account.id)} disabled={busy}>
                        <AccountAvatar account={account} />
                        <span>
                          <strong>{account.name}</strong>
                          <em>{account.type === 'msa' ? 'Microsoft' : account.type === 'yggdrasil' ? 'Yggdrasil' : '离线账户'}</em>
                        </span>
                        {account.online ? <Wifi size={13} /> : <WifiOff size={13} />}
                        <ChevronRight size={14} />
                      </button>
                      <button
                        type="button"
                        className="account-row-remove"
                        aria-label="移除账户"
                        disabled={busy}
                        onClick={() => void run(async () => { await logout(account.id) })}
                      >
                        <LogOut size={14} />
                      </button>
                    </div>
                  ))}
              </div>
            ) : null}

            <div className="drawer-divider" />

            <div className="auth-tabs">
              {tabOptions.map((option) => {
                const Icon = option.icon
                return (
                  <button key={option.id} type="button" className={classNames(tab === option.id && 'is-active')} onClick={() => { setTab(option.id); setProfiles([]) }}>
                    <Icon size={14} />
                    {option.label}
                  </button>
                )
              })}
            </div>

            <AnimatePresence mode="wait">
              {tab === 'offline' ? (
                <motion.div key="offline" className="auth-pane" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
                  <p className="auth-desc">使用任意 3–16 位用户名进入离线模式。适合本地游戏与测试，不拥有正版皮肤。</p>
                  <div className="field">
                    <label className="field-label">
                      玩家名 <em>USERNAME</em>
                    </label>
                    <input className="text-input" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="例如：Ember" onKeyDown={(e) => e.key === 'Enter' && void submitOffline()} maxLength={16} />
                  </div>
                  <Button variant="primary" icon={UserRound} loading={busy} onClick={() => void submitOffline()} className="auth-submit">
                    以离线身份进入
                  </Button>
                </motion.div>
              ) : null}

              {tab === 'microsoft' ? (
                <motion.div key="ms" className="auth-pane" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
                  <div className="ms-card">
                    <div className="ms-logo">
                      <i /><i /><i /><i />
                    </div>
                    <div>
                      <strong>Microsoft 正版登录</strong>
                      <p>弹出官方登录窗口，获取正版档案、皮肤与披风数据。</p>
                    </div>
                  </div>
                  <Button variant="primary" icon={ShieldCheck} loading={busy} onClick={() => void submitMicrosoft()} className="auth-submit">
                    打开 Microsoft 登录
                  </Button>
                  <p className="auth-fineprint">登录信息由 EML 处理，令牌在本地使用系统安全存储加密保存。EMBER 不会上传你的账户数据。</p>
                </motion.div>
              ) : null}

              {tab === 'yggdrasil' ? (
                <motion.div key="yg" className="auth-pane" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
                  <p className="auth-desc">连接 Drasl / authlib-injector 等 Yggdrasil 兼容认证服务器。</p>
                  <div className="field">
                    <label className="field-label">
                      认证服务器 <em>YGGDRASIL URL</em>
                    </label>
                    <input className="text-input mono" value={server} onChange={(e) => setServer(e.target.value)} placeholder="https://auth.example.com" spellCheck={false} />
                  </div>
                  <div className="field">
                    <label className="field-label">
                      用户名 / 邮箱 <em>USERNAME</em>
                    </label>
                    <input className="text-input" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
                  </div>
                  <div className="field">
                    <label className="field-label">
                      密码 <em>PASSWORD</em>
                    </label>
                    <input className="text-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" onKeyDown={(e) => e.key === 'Enter' && void submitYgg()} />
                  </div>
                  <Button variant="primary" icon={Globe2} loading={busy} onClick={() => void submitYgg()} className="auth-submit">
                    验证并登录
                  </Button>
                  {profiles.length ? (
                    <div className="profile-picker">
                      <div className="drawer-section-label">选择角色档案</div>
                      {profiles.map((profile) => (
                        <button key={profile.id} type="button" disabled={busy || !pendingYgg} onClick={() => void submitYgg(profile.id)}>
                          <span>{profile.name}</span>
                          <em>{profile.id.slice(0, 8)}…</em>
                          <ChevronRight size={14} />
                        </button>
                      ))}
                    </div>
                  ) : null}
                </motion.div>
              ) : null}
            </AnimatePresence>

            <div className="drawer-foot">
              <Pill tone="default">{accounts.length} 个已保存账户</Pill>
              {busy ? <span className="drawer-busy"><Spinner size={13} /> 正在连接认证服务器…</span> : null}
            </div>
          </motion.aside>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body
  )
}
