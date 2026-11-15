import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

// In Electron transparenter Fensterhintergrund (Vibrancy) und Platz für die Ampel-Buttons.
if (window.printnestDesktop?.isElectron) {
  document.documentElement.classList.add('is-electron');
}

bootstrapApplication(App, appConfig).catch((err) => console.error(err));
