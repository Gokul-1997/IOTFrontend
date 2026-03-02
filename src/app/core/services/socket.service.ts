import { Injectable } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class SocketService {

  private socket!: Socket;
  private isConnecting = false;

  async connect(): Promise<void> {

    if (this.socket?.connected) return;

    if (!this.socket) {
      this.socket = io(environment.socketUrl, {
        transports: ['websocket'],
        autoConnect: false,
        auth: (cb) => {
          cb({ token: localStorage.getItem('token') });
        }
      });

      // Debug listener (remove in production)
      this.socket.onAny((event, ...args) => {
        console.log('📡 Event received:', event, args);
      });
    }

    if (this.isConnecting) return;

    this.isConnecting = true;

    return new Promise((resolve, reject) => {

      this.socket.once('connect', () => {
        console.log('✅ Socket Connected:', this.socket.id);
        this.isConnecting = false;
        resolve();
      });

      this.socket.once('connect_error', (err) => {
        console.error('❌ Socket Error:', err.message);
        this.isConnecting = false;
        reject(err);
      });

      this.socket.connect();
    });
  }

  joinPlant(plantId: number): void {
    if (!this.socket?.connected) {
      console.log('⚠️ Cannot join plant. Socket not connected.');
      return;
    }

    console.log('🏭 Joining plant room:', plantId);
    this.socket.emit('joinPlant', plantId);
  }

  onMachineUpdate(callback: (data: any) => void): void {
    if (!this.socket) return;

    this.socket.off('machineUpdate');
    this.socket.on('machineUpdate', callback);
  }

  disconnect(): void {
    this.socket?.disconnect();
  }
}