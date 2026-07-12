export interface User {
  id: number;
  email: string;
  name: string;
  role: 'admin' | 'user' | 'moderator';
  createdAt: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    cursor: string | null;
    hasMore: boolean;
    total: number;
  };
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface TokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export class UsersApiClient {
  constructor(private readonly baseUrl: string) {}

  async getUser(id: number): Promise<User> {
    const res = await fetch(`${this.baseUrl}/v1/users/${id}`, {
      headers: { Authorization: 'Bearer test-token' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json() as Promise<User>;
  }

  async listUsers(cursor?: string): Promise<PaginatedResponse<User>> {
    const url = new URL(`${this.baseUrl}/v1/users`);
    if (cursor) url.searchParams.set('cursor', cursor);
    const res = await fetch(url.toString(), {
      headers: { Authorization: 'Bearer test-token' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json() as Promise<PaginatedResponse<User>>;
  }

  async createUser(data: {
    email: string;
    name: string;
    password: string;
  }): Promise<User> {
    const res = await fetch(`${this.baseUrl}/v1/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-token',
      },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json() as Promise<User>;
  }

  async deleteUser(id: number): Promise<void> {
    const res = await fetch(`${this.baseUrl}/v1/users/${id}`, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer test-token' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }
}

export class AuthApiClient {
  constructor(private readonly baseUrl: string) {}

  async login(credentials: LoginCredentials): Promise<TokenResponse> {
    const res = await fetch(`${this.baseUrl}/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credentials),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json() as Promise<TokenResponse>;
  }

  async refresh(refreshToken: string): Promise<TokenResponse> {
    const res = await fetch(`${this.baseUrl}/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json() as Promise<TokenResponse>;
  }

  async logout(refreshToken: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/v1/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }
}
