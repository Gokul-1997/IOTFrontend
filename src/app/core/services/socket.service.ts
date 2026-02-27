import { Injectable } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class SocketService {

  private socket!: Socket;

  connect(): Promise<void> {
    return new Promise((resolve) => {

      this.socket = io(environment.socketUrl, {
        auth: {
          token: localStorage.getItem('token')
        },
        transports: ['websocket'],
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000
      });

      this.socket.on('connect', () => {
        console.log('✅ Socket connected:', this.socket.id);
        resolve();
      });

      this.socket.on('connect_error', (err) => {
        console.error('Socket error:', err.message);
      });
    });
  }

  joinPlant(plantId: number): void {
    if (!this.socket) return;
    console.log('Joining plant room:', plantId);
    this.socket.emit('joinPlant', plantId);
  }

  onMachineUpdate(callback: (data: any) => void): void {
    if (!this.socket) return;
    this.socket.off('machineUpdate');
    this.socket.on('machineUpdate', callback);
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
    }
  }
}