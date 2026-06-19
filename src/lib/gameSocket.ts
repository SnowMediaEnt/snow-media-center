import { io, Socket } from 'socket.io-client';
import { supabase } from '@/integrations/supabase/client';

export type GameSocketStatus = 'idle' | 'connecting' | 'connected' | 'error' | 'reconnecting';

export interface WhoAmI {
  userId: string;
  email?: string;
  balance: number;
}

type Listener = () => void;

const SERVER_URL = 'https://smcdreamstreams.store';
const SOCKET_PATH = '/gamesocket';

class GameSocketManager {
  private socket: Socket | null = null;
  private listeners = new Set<Listener>();
  private currentToken: string | null = null;
  private authSubInitialized = false;

  status: GameSocketStatus = 'idle';
  balance: number | null = null;
  userId: string | null = null;
  errorMessage: string | null = null;

  subscribe(l: Listener) {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  }

  private emitChange() {
    this.listeners.forEach((l) => l());
  }

  private setStatus(s: GameSocketStatus, err?: string | null) {
    this.status = s;
    if (err !== undefined) this.errorMessage = err;
    this.emitChange();
  }

  async ensureAuthListener() {
    if (this.authSubInitialized) return;
    this.authSubInitialized = true;
    supabase.auth.onAuthStateChange((_event, session) => {
      const token = session?.access_token ?? null;
      if (token !== this.currentToken) {
        if (token) {
          this.connectWithToken(token);
        } else {
          this.disconnect();
        }
      }
    });
  }

  async connect() {
    await this.ensureAuthListener();
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token ?? null;
    if (!token) {
      this.setStatus('error', 'Not signed in');
      return;
    }
    if (this.socket && this.socket.connected && token === this.currentToken) {
      return;
    }
    this.connectWithToken(token);
  }

  private connectWithToken(token: string) {
    this.currentToken = token;
    // Tear down existing
    if (this.socket) {
      try { this.socket.removeAllListeners(); this.socket.disconnect(); } catch {}
      this.socket = null;
    }

    this.setStatus('connecting', null);

    const socket = io(SERVER_URL, {
      path: SOCKET_PATH,
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      timeout: 15000,
    });
    this.socket = socket;

    socket.on('connect', () => {
      this.setStatus('connected', null);
      this.requestWhoami();
    });

    socket.on('reconnect_attempt', () => {
      this.setStatus('reconnecting');
    });

    socket.on('connect_error', (err) => {
      this.setStatus('error', err?.message || 'Connection error');
    });

    socket.on('disconnect', () => {
      if (this.status !== 'error') this.setStatus('reconnecting');
    });

    socket.on('balance', (payload: { balance: number }) => {
      if (payload && typeof payload.balance === 'number') {
        this.balance = payload.balance;
        this.emitChange();
      }
    });
  }

  private requestWhoami(retry = 0) {
    if (!this.socket) return;
    let acked = false;
    const timeout = setTimeout(() => {
      if (acked) return;
      // Soft retry up to 3 times
      if (retry < 3) this.requestWhoami(retry + 1);
      else this.setStatus('error', 'Could not load chips');
    }, 8000);

    this.socket.emit('whoami', (resp: any) => {
      acked = true;
      clearTimeout(timeout);
      if (!resp || resp.error) {
        // Try get_balance as fallback once
        if (retry < 2) {
          setTimeout(() => this.requestWhoami(retry + 1), 750);
          return;
        }
        this.setStatus('error', resp?.error || 'Could not load chips');
        return;
      }
      this.userId = resp.userId ?? null;
      if (typeof resp.balance === 'number') this.balance = resp.balance;
      this.setStatus('connected', null);
    });
  }

  refreshBalance() {
    if (!this.socket || !this.socket.connected) return;
    this.socket.emit('get_balance', (resp: any) => {
      if (resp && typeof resp.balance === 'number') {
        this.balance = resp.balance;
        this.emitChange();
      }
    });
  }

  async claimDailySpin(clientSeed?: string): Promise<any> {
    if (!this.socket || !this.socket.connected) {
      await this.connect();
    }
    return new Promise((resolve, reject) => {
      if (!this.socket) {
        reject(new Error('not_connected'));
        return;
      }
      let acked = false;
      const timeout = setTimeout(() => {
        if (!acked) reject(new Error('timeout'));
      }, 20000);
      this.socket.emit('claim_daily_spin', { clientSeed: clientSeed ?? null }, (resp: any) => {
        acked = true;
        clearTimeout(timeout);
        if (resp && resp.ok === true && typeof resp.balance === 'number') {
          this.balance = resp.balance;
          this.emitChange();
        }
        resolve(resp);
      });
    });
  }

  async spinSlots(bet: number, clientSeed?: string): Promise<any> {
    return this.emitWithAck('slots_spin', { bet, clientSeed: clientSeed ?? null });
  }

  private async emitWithAck(event: string, payload: any, timeoutMs = 20000): Promise<any> {
    if (!this.socket || !this.socket.connected) {
      await this.connect();
    }
    return new Promise((resolve, reject) => {
      if (!this.socket) {
        reject(new Error('not_connected'));
        return;
      }
      let acked = false;
      const t = setTimeout(() => {
        if (!acked) reject(new Error('timeout'));
      }, timeoutMs);
      const cb = (resp: any) => {
        acked = true;
        clearTimeout(t);
        if (resp && typeof resp.balance === 'number') {
          this.balance = resp.balance;
          this.emitChange();
        }
        resolve(resp);
      };
      if (payload === undefined) this.socket.emit(event, cb);
      else this.socket.emit(event, payload, cb);
    });
  }

  async dealBlackjack(bet: number, clientSeed?: string): Promise<any> {
    return this.emitWithAck('bj_deal', { bet, clientSeed: clientSeed ?? null });
  }
  async hit(): Promise<any> { return this.emitWithAck('bj_hit', undefined); }
  async stand(): Promise<any> { return this.emitWithAck('bj_stand', undefined); }
  async double(): Promise<any> { return this.emitWithAck('bj_double', undefined); }

  async dealVideoPoker(bet: number, clientSeed?: string): Promise<any> {
    return this.emitWithAck('vp_deal', { bet, clientSeed: clientSeed ?? null });
  }
  async drawVideoPoker(holds: boolean[]): Promise<any> {
    return this.emitWithAck('vp_draw', { holds });
  }

  async spinRoulette(payload: { bets: any[]; wheel: 'european' | 'american'; clientSeed?: string | null }): Promise<any> {
    return this.emitWithAck('roulette_spin', {
      bets: payload.bets,
      wheel: payload.wheel,
      clientSeed: payload.clientSeed ?? null,
    });
  }

  async dealCasinoHoldem(ante: number, clientSeed?: string): Promise<any> {
    return this.emitWithAck('ch_deal', { ante, clientSeed: clientSeed ?? null });
  }
  async callCasinoHoldem(multiplier: number = 2): Promise<any> {
    return this.emitWithAck('ch_call', { multiplier });
  }
  async foldCasinoHoldem(): Promise<any> {
    return this.emitWithAck('ch_fold', {});
  }

  disconnect() {
    this.currentToken = null;
    this.balance = null;
    this.userId = null;
    if (this.socket) {
      try { this.socket.removeAllListeners(); this.socket.disconnect(); } catch {}
      this.socket = null;
    }
    this.setStatus('idle', null);
  }
}

export const gameSocket = new GameSocketManager();
