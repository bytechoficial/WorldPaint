class Auth {
  constructor() {
    this.currentUser = localStorage.getItem('worldpaint_user') || null;
  }

  async init() {
    await api.readOrCreateFile('data/users.json', JSON.stringify({ users: [] }));
  }

  async register(username, password) {
    if (username.length < 3) throw new Error('Usuário deve ter pelo menos 3 caracteres');
    if (password.length < 4) throw new Error('Senha deve ter pelo menos 4 caracteres');

    const file = await api.getFile('data/users.json');
    if (!file) throw new Error('Erro ao acessar banco de dados');

    const data = JSON.parse(file.content);
    if (data.users.find(u => u.username === username)) {
      throw new Error('Usuário já existe');
    }

    const hash = await this.hashPassword(password);
    data.users.push({ username, passwordHash: hash, createdAt: new Date().toISOString() });

    let success = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await api.updateFile('data/users.json', JSON.stringify(data, null, 2), file.sha);
        success = true;
        break;
      } catch (e) {
        if (!e.message.includes('SHA')) throw e;
        const fresh = await api.getFile('data/users.json');
        if (!fresh) throw new Error('Erro ao atualizar');
        const freshData = JSON.parse(fresh.content);
        freshData.users.push({ username, passwordHash: hash, createdAt: new Date().toISOString() });
        data.users = freshData.users;
        file.sha = fresh.sha;
      }
    }

    if (!success) throw new Error('Erro ao registrar. Tente novamente.');
    this.currentUser = username;
    localStorage.setItem('worldpaint_user', username);
  }

  async login(username, password) {
    const file = await api.getFile('data/users.json');
    if (!file) throw new Error('Erro ao acessar banco de dados');

    const data = JSON.parse(file.content);
    const user = data.users.find(u => u.username === username);
    if (!user) throw new Error('Usuário não encontrado');

    const hash = await this.hashPassword(password);
    if (user.passwordHash !== hash) throw new Error('Senha incorreta');

    this.currentUser = username;
    localStorage.setItem('worldpaint_user', username);
  }

  logout() {
    this.currentUser = null;
    localStorage.removeItem('worldpaint_user');
  }

  async hashPassword(password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password + 'WorldPaintSalt2024');
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }
}

const auth = new Auth();
