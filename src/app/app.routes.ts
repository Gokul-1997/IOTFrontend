import { Routes } from '@angular/router';
import { LoginComponent } from './pages/auth/login.component';
import { authGuard } from './core/guards/auth.guard';

import { MachineListComponent } from './pages/machines/machine-list.component';
import { MachineFormComponent } from './pages/machines/machine-form.component';

import { ShiftListComponent } from './pages/shifts/shift-list.component';
import { ShiftFormComponent } from './pages/shifts/shift-form.component';

import { OperatorListComponent } from './pages/operators/operator-list.component';
import { OperatorFormComponent } from './pages/operators/operator-form.component';

import { AssignmentComponent } from './pages/assignments/assignment.component';
import { OperatorShiftComponent } from './pages/assignments/operator-shift.component';

import { MachineShiftComponent } from './pages/machine-shifts/machine-shift.component';
import { HourlyOeeComponent } from './pages/oee/hourly-oee.component';

import { PlantListComponent } from './pages/plants/plant-list.component';
import { PlantFormComponent } from './pages/plants/plant-form.component';
import { ResetPasswordComponent } from './pages/forgot/reset-password.component';
import { ForgotPasswordComponent } from './pages/forgot/forgot-password.component';
import { MainLayoutComponent } from './layout/main-layout/main-layout';
import { Reports } from './pages/reports/reports';

export const routes: Routes = [

  // 🔐 PUBLIC ROUTES
  { path: 'login', component: LoginComponent },
  { path: 'forgot-password', component: ForgotPasswordComponent },
  { path: 'reset-password/:token', component: ResetPasswordComponent },

  // 🔒 PROTECTED ROUTES (WITH SIDEBAR)
  {
    path: '',
    component: MainLayoutComponent,
    canActivate: [authGuard],
    children: [

      { path: 'dashboard', loadComponent: () => import('./pages/dashboard/dashboard.component').then(m => m.DashboardComponent) },

      { path: 'machines', component: MachineListComponent },
      { path: 'machines/create', component: MachineFormComponent },

      { path: 'shifts', component: ShiftListComponent },
      { path: 'shifts/create', component: ShiftFormComponent },

      { path: 'operators', component: OperatorListComponent },
      { path: 'operators/create', component: OperatorFormComponent },

      { path: 'assignments', component: AssignmentComponent },
      { path: 'assignments/operator-shift', component: OperatorShiftComponent },

      { path: 'machine-shifts', component: MachineShiftComponent },

      { path: 'plants', component: PlantListComponent },
      { path: 'plants/create', component: PlantFormComponent },

      { path: 'oee/hourly', component: HourlyOeeComponent },

      { path: 'reports', component: Reports },

      // DEFAULT
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' }
    ]
  },

  // FALLBACK
  { path: '**', redirectTo: 'login' }
];

