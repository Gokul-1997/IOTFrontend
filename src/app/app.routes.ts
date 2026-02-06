import { Routes } from '@angular/router';
import { LoginComponent } from './pages/auth/login.component';
import { authGuard } from './core/guards/auth.guard';

import { MachinesComponent } from './pages/machines/machines.component';
import { MachineFormComponent } from './pages/machines/machine-form.component';

import { ShiftsComponent } from './pages/shifts/shifts.component';
import { ShiftFormComponent } from './pages/shifts/shift-form.component';

import { OperatorListComponent } from './pages/operators/operator-list.component';
import { OperatorFormComponent } from './pages/operators/operator-form.component';

import { AssignmentComponent } from './pages/assignments/assignment.component';
import { OperatorShiftComponent } from './pages/assignments/operator-shift.component';

import { MachineShiftComponent } from './pages/machine-shifts/machine-shift.component';

import { PlantsComponent } from './pages/plants/plants.component';
import { PlantFormComponent } from './pages/plants/plant-form.component';
import { ResetPasswordComponent } from './pages/forgot/reset-password.component';
import { ForgotPasswordComponent } from './pages/forgot/forgot-password.component';
import { MainLayoutComponent } from './layout/main-layout/main-layout';
import { Reports } from './pages/reports/reports';
import { OeeReportsComponent } from './pages/oee-reports/oee-reports';
import { Charts } from './pages/charts/charts';
import { Quality } from './pages/quality/quality';

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

      { path: 'machines', component: MachinesComponent },
      { path: 'machines/create', component: MachineFormComponent },

      { path: 'shifts', component: ShiftsComponent },
      { path: 'shifts/create', component: ShiftFormComponent },

      { path: 'operators', component: OperatorListComponent },
      { path: 'operators/create', component: OperatorFormComponent },

      { path: 'assignments', component: AssignmentComponent },
      { path: 'assignments/operator-shift', component: OperatorShiftComponent },

      { path: 'machine-shifts', component: MachineShiftComponent },

      { path: 'plants', component: PlantsComponent },
      { path: 'plants/create', component: PlantFormComponent },

      { path: 'reports', component: Reports },
      { path: 'oee-reports', component: OeeReportsComponent },
      { path: 'charts', component: Charts },
      { path: 'quality', component: Quality },

      // DEFAULT
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' }
    ]
  },

  // FALLBACK
  { path: '**', redirectTo: 'login' }
];

