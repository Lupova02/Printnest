import { TestBed } from '@angular/core/testing';
import { StarRating } from './star-rating';

describe('StarRating', () => {
  function setup(value: number | null) {
    const fixture = TestBed.createComponent(StarRating);
    fixture.componentRef.setInput('value', value);
    fixture.detectChanges();
    const emitted: number[] = [];
    fixture.componentInstance.rate.subscribe((n) => emitted.push(n));
    const buttons = [...fixture.nativeElement.querySelectorAll('button')] as HTMLButtonElement[];
    return { fixture, emitted, buttons };
  }

  it('zeigt fünf Sterne mit Bewertungszustand', () => {
    const { buttons, fixture } = setup(3);
    expect(buttons).toHaveLength(5);
    expect(buttons.map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'true', 'true', 'false', 'false']);
    expect(fixture.nativeElement.querySelector('[role="group"]').getAttribute('aria-label')).toContain('3 von 5');
  });

  it('Klick setzt die Bewertung', () => {
    const { buttons, emitted } = setup(null);
    buttons[3].click();
    expect(emitted).toEqual([4]);
  });

  it('erneuter Klick auf denselben Stern entfernt die Bewertung', () => {
    const { buttons, emitted } = setup(2);
    expect(buttons[1].getAttribute('aria-label')).toBe('Bewertung 2 entfernen');
    buttons[1].click();
    expect(emitted).toEqual([0]);
  });

  it('Hover zeigt die Vorschau', () => {
    const { buttons, fixture } = setup(1);
    buttons[4].dispatchEvent(new MouseEvent('mouseenter'));
    fixture.detectChanges();
    expect(buttons.filter((b) => b.classList.contains('is-on'))).toHaveLength(5);
  });

  it('kompakt: Sterne sind nicht per Tab erreichbar', () => {
    const fixture = TestBed.createComponent(StarRating);
    fixture.componentRef.setInput('compact', true);
    fixture.detectChanges();
    const tabindexes = [...fixture.nativeElement.querySelectorAll('button')].map((b: HTMLElement) => b.tabIndex);
    expect(tabindexes.every((t) => t === -1)).toBe(true);
  });
});
