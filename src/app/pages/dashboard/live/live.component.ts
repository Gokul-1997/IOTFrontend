import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../../../shared/icon/icon';

@Component({
  selector: 'app-live',
  imports: [CommonModule, FormsModule, IconComponent],
  templateUrl: './live.component.html',
  styleUrl: './live.component.scss',
})
export class LiveComponent {

}
