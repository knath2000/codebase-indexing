import { createModuleLogger } from '../logging/logger.js'
import { sign } from 'jsonwebtoken'

/**
 * Minimal GitHub App client for generating app JWT, resolving installation id for a repo,
 * and creating an installation access token to perform authenticated operations.
 */
export class GitHubAppClient {
  private appId: string
  private privateKeyPem: string
  private readonly log = createModuleLogger('github-app-client')

  constructor(appId: string, privateKeyPem: string) {
    if (!appId || !privateKeyPem) {
      throw new Error('GitHubAppClient requires GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY')
    }
    this.appId = appId
    this.privateKeyPem = privateKeyPem
  }

  /** Generate a short-lived JWT for the GitHub App (valid ~60 seconds by default). */
  private generateAppJwt(): string {
    const now = Math.floor(Date.now() / 1000)
    const payload = {
      iat: now - 30, // backdate slightly to avoid clock skew
      exp: now + 9 * 60, // 9 minutes
      iss: this.appId,
    }
    const token = sign(payload as any, this.privateKeyPem, { algorithm: 'RS256' })
    return token
  }

  /** Look up the installation id for a given repo (requires App JWT). */
  async getInstallationIdForRepo(owner: string, repo: string): Promise<number> {
    const appJwt = this.generateAppJwt()
    const url = `https://api.github.com/repos/${owner}/${repo}/installation`
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${appJwt}`,
        Accept: 'application/vnd.github+json',
      },
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      this.log.error({ status: res.status, body: text }, 'Failed to get installation for repo')
      throw new Error(`GitHub get installation failed: ${res.status}`)
    }
    const data = await res.json() as any
    const id = data?.id
    if (!id) throw new Error('No installation id returned for repo')
    return id
  }

  /** Create a short-lived installation access token for a given installation id. */
  async createInstallationAccessToken(installationId: number): Promise<string> {
    const appJwt = this.generateAppJwt()
    const url = `https://api.github.com/app/installations/${installationId}/access_tokens`
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${appJwt}`,
        Accept: 'application/vnd.github+json',
      },
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      this.log.error({ status: res.status, body: text }, 'Failed to create installation access token')
      throw new Error(`GitHub create installation token failed: ${res.status}`)
    }
    const data = await res.json() as any
    const token = data?.token
    if (!token) throw new Error('No installation token in response')
    return token
  }
}


