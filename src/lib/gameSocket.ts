import { io, Socket } from 'socket.io-client';
import { supabase } from '@/integrations/supabase/client';
import { trackEvent } from '@/lib/analytics';

export type GameSocketStatus = 'idle' | 'connecting' | 'connected' | 'error' | 'reconnecting';

export interface WhoAmI {
  userId: string;
  email?: string;
  balance: number;
}

export interface SlotStateAck {
  ok?: boolean;
  collectors?: unknown;
  freeSpinsRemaining?: number;
  multiplier?: number;
  error?: string;
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
        try {
          if (resp?.ok === true) {
            trackEvent('daily_spin_claim', 'games', {
              coins: Number(resp?.award ?? resp?.amount ?? resp?.win ?? 0) || null,
              balance_after: typeof this.balance === 'number' ? this.balance : null,
            });
          }
        } catch { /* ignore */ }
        resolve(resp);
      });
    });
  }

  /**
   * Every chip a player puts down, by game. This is the only place all six
   * games meet, so counting here answers "are the coins being used, and how
   * many a day" without touching a single game screen. The wager is what was
   * asked for; the balance the server sends back rides along so a day's
   * events also show where people ended up.
   */
  private noteWager(game: string, coins: number, extra?: Record<string, unknown>) {
    try {
      if (!Number.isFinite(coins) || coins <= 0) return;
      trackEvent('game_wager', 'games', {
        game,
        coins: Math.round(coins),
        balance_after: typeof this.balance === 'number' ? this.balance : null,
        ...(extra ?? {}),
      });
    } catch { /* analytics must never break a hand */ }
  }

  async spinSlots(bet: number, clientSeed?: string): Promise<any> {
    const res = await this.emitWithAck('slots_spin', { bet, clientSeed: clientSeed ?? null });
    this.noteWager('slots', bet);
    return res;
  }

  async getSlotsState(bet: number): Promise<SlotStateAck> {
    return this.emitWithAck('slots_state', { bet }, 10000);
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

  async dealBlackjack(bet: number, clientSeed?: string, variant: string = 'classic', sideBets?: Record<string, number>): Promise<any> {
    const res = await this.emitWithAck('bj_deal', { bet, clientSeed: clientSeed ?? null, variant, sideBets });
    this.noteWager('blackjack', bet, { variant });
    return res;
  }
  async hit(): Promise<any> { return this.emitWithAck('bj_hit', undefined); }
  async split(): Promise<any> { return this.emitWithAck('bj_split', undefined); }
  async stand(): Promise<any> { return this.emitWithAck('bj_stand', undefined); }
  async double(): Promise<any> {
    const res = await this.emitWithAck('bj_double', undefined);
    // A double puts the same stake down again; the server echoes the hand's
    // bet, so use it when it is there.
    this.noteWager('blackjack', Number(res?.bet ?? res?.hand?.bet ?? 0), { action: 'double' });
    return res;
  }

  async dealVideoPoker(bet: number, clientSeed?: string): Promise<any> {
    const res = await this.emitWithAck('vp_deal', { bet, clientSeed: clientSeed ?? null });
    this.noteWager('video-poker', bet);
    return res;
  }
  async drawVideoPoker(holds: boolean[]): Promise<any> {
    return this.emitWithAck('vp_draw', { holds });
  }

  async spinRoulette(payload: { bets: any[]; wheel: 'european' | 'american'; clientSeed?: string | null }): Promise<any> {
    const res = await this.emitWithAck('roulette_spin', {
      bets: payload.bets,
      wheel: payload.wheel,
      clientSeed: payload.clientSeed ?? null,
    });
    // One spin can carry many bets; the table's total is what left the balance.
    const total = (payload.bets ?? []).reduce<number>(
      (sum, b) => sum + (Number(b?.amount ?? b?.bet ?? 0) || 0), 0,
    );
    this.noteWager('roulette', total, { wheel: payload.wheel, bets: (payload.bets ?? []).length });
    return res;
  }

  async dealCasinoHoldem(ante: number, clientSeed?: string): Promise<any> {
    const res = await this.emitWithAck('ch_deal', { ante, clientSeed: clientSeed ?? null });
    this.noteWager('casino-holdem', ante, { action: 'ante' });
    return res;
  }
  async callCasinoHoldem(multiplier: number = 2): Promise<any> {
    const res = await this.emitWithAck('ch_call', { multiplier });
    // The call costs the ante times the multiplier; the server echoes both.
    const ante = Number(res?.ante ?? res?.hand?.ante ?? 0) || 0;
    this.noteWager('casino-holdem', ante * multiplier, { action: 'call', multiplier });
    return res;
  }
  async foldCasinoHoldem(): Promise<any> {
    return this.emitWithAck('ch_fold', {});
  }

  async playArcade(payload: {
    game: 'plinko' | 'dice' | 'trivia'; bet: number; risk?: string; dice?: number[];
    correct?: number; total?: number; score?: number; difficulty?: string; mode?: string; clientSeed?: string;
  }): Promise<any> {
    const res = await this.emitWithAck('arcade_play', payload);
    this.noteWager(payload.game, payload.bet, { mode: payload.risk ?? payload.difficulty ?? 'classic' });
    return res;
  }

  async getLoungeState(): Promise<any> { return this.emitWithAck('lounge_state', undefined, 10000); }
  async setGameName(gameName: string): Promise<any> {
    return this.emitWithAck('lounge_set_name', { gameName }, 10000);
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
