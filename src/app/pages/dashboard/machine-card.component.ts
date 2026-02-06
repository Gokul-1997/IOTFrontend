import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  standalone: true,
  selector: 'app-machine-card',
  imports: [CommonModule],
  templateUrl: './machine-card.component.html'
})
export class MachineCardComponent {

    @Input() machine!: any;

  statusClass() {
    switch (this.machine?.status) {
      case 'RUN': return 'text-green-500';
      case 'IDLE': return 'text-yellow-500';
      default: return 'text-red-500';
    }
  }
}
