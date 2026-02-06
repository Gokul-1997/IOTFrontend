import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Quality } from './quality';

describe('Quality', () => {
  let component: Quality;
  let fixture: ComponentFixture<Quality>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Quality]
    })
    .compileComponents();

    fixture = TestBed.createComponent(Quality);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
