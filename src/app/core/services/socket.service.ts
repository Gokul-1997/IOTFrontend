import { Injectable, NgZone } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class SocketService {

  private socket!: Socket;

  private isConnecting = false;
  private paused = false;

  private plantId?: number;

  constructor(private zone: NgZone) {}

  /* ================= CONNECT ================= */

  async connect(): Promise<void> {

    if (this.socket?.connected) return;

    if (!this.socket) {

      this.socket = io(environment.socketUrl, {
        transports: ['websocket'],
        autoConnect: false,

        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 2000,
        reconnectionDelayMax: 10000,

        auth: (cb) => {
          cb({ token: localStorage.getItem('token') });
        }
      });

      /* ===== CONNECTION EVENTS ===== */

      this.socket.on('connect', () => {
        console.log('✅ Socket connected:', this.socket.id);

        if (this.plantId) {
          this.joinPlant(this.plantId);
        }
      });

      this.socket.on('disconnect', (reason) => {
        console.log('⚠ Socket disconnected:', reason);
      });

      this.socket.on('connect_error', (err) => {
        console.error('❌ Socket connect error:', err.message);
      });

    }

    if (this.isConnecting) return;

    this.isConnecting = true;

    return new Promise((resolve, reject) => {

      this.socket.once('connect', () => {
        this.isConnecting = false;
        resolve();
      });

      this.socket.once('connect_error', (err) => {
        this.isConnecting = false;
        reject(err);
      });

      this.socket.connect();

    });

  }

  /* ================= JOIN ROOM ================= */

  joinPlant(plantId: number): void {

    this.plantId = plantId;

    if (!this.socket?.connected) {
      console.warn('⚠ Cannot join plant. Socket not connected.');
      return;
    }

    console.log('🏭 Joining plant:', plantId);

    this.socket.emit('joinPlant', plantId);

  }

  /* ================= MACHINE UPDATES ================= */

  onMachineUpdate(callback: (data: any) => void): void {

    if (!this.socket) return;

    this.socket.off('machineUpdate');

    this.socket.on('machineUpdate', (data) => {

      if (this.paused) return;

      /* Run inside Angular zone for UI updates */
      this.zone.run(() => {
        callback(data);
      });

    });

  }

  /* ================= PAUSE / RESUME ================= */

  pauseUpdates(): void {
    console.log('⏸ Socket updates paused');
    this.paused = true;
  }

  resumeUpdates(): void {
    console.log('▶ Socket updates resumed');
    this.paused = false;
  }

  /* ================= DISCONNECT ================= */

  disconnect(): void {

    if (!this.socket) return;

    console.log('🔌 Disconnecting socket');

    this.socket.removeAllListeners();
    this.socket.disconnect();

  }

}