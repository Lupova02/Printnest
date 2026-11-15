import { Routes } from '@angular/router';

/** Einstiegsrouten – Dashboard wird lazy geladen. */
export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./features/dashboard/dashboard').then((m) => m.Dashboard),
    title: 'Printnest',
  },
  { path: '**', redirectTo: '' },
];
