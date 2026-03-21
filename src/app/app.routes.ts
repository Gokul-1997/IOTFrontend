import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';

export const routes: Routes = [

  // PUBLIC ROUTES
  { path: 'login', loadComponent: () => import('./pages/auth/login.component').then(m => m.LoginComponent) },
  { path: 'forgot-password', loadComponent: () => import('./pages/forgot/forgot-password.component').then(m => m.ForgotPasswordComponent) },
  { path: 'reset-password/:token', loadComponent: () => import('./pages/forgot/reset-password.component').then(m => m.ResetPasswordComponent) },

  // PROTECTED ROUTES (WITH SIDEBAR)
  {
    path: '',
    loadComponent: () => import('./layout/main-layout/main-layout').then(m => m.MainLayoutComponent),
    canActivate: [authGuard],
    children: [

      { path: 'dashboard', loadComponent: () => import('./pages/dashboard/dashboard.component').then(m => m.DashboardComponent) },
      { path: 'dashboard/live/:id', loadComponent: () => import('./pages/dashboard/live/live.component').then(m => m.LiveComponent) },

      { path: 'component', loadComponent: () => import('./pages/component/component_list.component').then(m => m.ComponentList) },

      { path: 'machines', loadComponent: () => import('./pages/machines/machines.component').then(m => m.MachinesComponent) },
      { path: 'machines/create', loadComponent: () => import('./pages/machines/machine-form.component').then(m => m.MachineFormComponent) },

      { path: 'shifts', loadComponent: () => import('./pages/shifts/shifts.component').then(m => m.ShiftsComponent) },
      { path: 'shifts/create', loadComponent: () => import('./pages/shifts/shift-form.component').then(m => m.ShiftFormComponent) },

      { path: 'operators', loadComponent: () => import('./pages/operators/operators.component').then(m => m.OperatorsComponent) },
      { path: 'operators/create', loadComponent: () => import('./pages/operators/operator-form.component').then(m => m.OperatorFormComponent) },

      { path: 'assignments', loadComponent: () => import('./pages/assignments/assignment.component').then(m => m.AssignmentComponent) },
      { path: 'assignments/operator-shift', loadComponent: () => import('./pages/assignments/operator-shift.component').then(m => m.OperatorShiftComponent) },

      { path: 'machine-shifts', loadComponent: () => import('./pages/machine-shifts/machine-shift.component').then(m => m.MachineShiftComponent) },

      { path: 'plants', loadComponent: () => import('./pages/plants/plants.component').then(m => m.PlantsComponent) },
      { path: 'plants/create', loadComponent: () => import('./pages/plants/plant-form.component').then(m => m.PlantFormComponent) },

      { path: 'reports', loadComponent: () => import('./pages/reports/reports').then(m => m.Reports) },
      { path: 'oee-reports', loadComponent: () => import('./pages/oee-reports/oee-reports').then(m => m.OeeReportsComponent) },
      { path: 'charts', loadComponent: () => import('./pages/charts/charts').then(m => m.Charts) },
      { path: 'quality', loadComponent: () => import('./pages/quality/quality').then(m => m.Quality) },
      { path: 'job', loadComponent: () => import('./pages/job/job-list.component').then(m => m.JobListComponent) },

      // DEFAULT
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' }
    ]
  },

  // FALLBACK
  { path: '**', redirectTo: 'login' }
];
