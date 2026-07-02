function getConfig() {
  const stored = localStorage.getItem('worldpaint_config');
  if (stored) {
    try { return JSON.parse(stored); } catch (_) {}
  }
  return CONFIG;
}

function encodeBase64(str) {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  return btoa(String.fromCharCode(...data));
}

function decodeBase64(str) {
  const binary = atob(str.replace(/\n/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const decoder = new TextDecoder();
  return decoder.decode(bytes);
}

class GitHubAPI {
  constructor() {
    this.cfg = getConfig();
    this.token = this.cfg.GITHUB_TOKEN;
    this.owner = this.cfg.GITHUB_OWNER;
    this.repo = this.cfg.GITHUB_REPO;
    this.baseUrl = 'https://api.github.com';
    this.headers = {
      'Authorization': `Bearer ${this.token}`,
      'Accept': 'application/vnd.github.v3+json',
    };
  }

  reloadConfig() {
    this.cfg = getConfig();
    this.token = this.cfg.GITHUB_TOKEN;
    this.owner = this.cfg.GITHUB_OWNER;
    this.repo = this.cfg.GITHUB_REPO;
    this.headers['Authorization'] = `Bearer ${this.token}`;
  }

  hasValidConfig() {
    return this.token && this.token.length > 10 && this.owner && this.repo;
  }

  async request(method, path, body = null) {
    const url = `${this.baseUrl}${path}`;
    const options = { method, headers: this.headers };
    if (body) options.body = JSON.stringify(body);
    const response = await fetch(url, options);
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message || `Erro na API: ${response.status}`);
    }
    return data;
  }

  async getFile(path) {
    try {
      const data = await this.request(
        'GET',
        `/repos/${this.owner}/${this.repo}/contents/${path}`
      );
      return { content: decodeBase64(data.content), sha: data.sha };
    } catch (e) {
      if (e.message.includes('Not Found')) return null;
      throw e;
    }
  }

  async createFile(path, content, message = 'WorldPaint: criar arquivo') {
    const data = await this.request(
      'PUT',
      `/repos/${this.owner}/${this.repo}/contents/${path}`,
      { message, content: encodeBase64(content) }
    );
    return data.content.sha;
  }

  async updateFile(path, content, sha, message = 'WorldPaint: atualizar') {
    const data = await this.request(
      'PUT',
      `/repos/${this.owner}/${this.repo}/contents/${path}`,
      { message, content: encodeBase64(content), sha }
    );
    return data.content.sha;
  }

  async readOrCreateFile(path, defaultContent) {
    const file = await this.getFile(path);
    if (file) return file;
    const sha = await this.createFile(path, defaultContent);
    return { content: defaultContent, sha };
  }
}

const api = new GitHubAPI();
