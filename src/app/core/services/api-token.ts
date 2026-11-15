import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { DesktopService } from './desktop.service';

export const TOKEN_HEADER = 'X-Printnest-Token';

/** Hängt das Start-Token an jede Anfrage an die lokale API. */
export const apiTokenInterceptor: HttpInterceptorFn = (req, next) => {
  const token = inject(DesktopService).token;
  if (!token || !req.url.startsWith('/api/')) return next(req);
  return next(req.clone({ setHeaders: { [TOKEN_HEADER]: token } }));
};

/**
 * URL mit Token als Query-Parameter – für Ressourcen, die per <img>, <video>,
 * PDF.js oder EventSource geladen werden und keine Header setzen können.
 */
export function withToken(url: string, token: string | null): string {
  if (!token) return url;
  return `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
}
