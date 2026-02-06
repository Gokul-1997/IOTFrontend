import { ComponentFixture, TestBed } from '@angular/core/testing';

import { OeeReports } from './oee-reports';

describe('OeeReports', () => {
  let component: OeeReports;
  let fixture: ComponentFixture<OeeReports>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OeeReports]
    })
    .compileComponents();

    fixture = TestBed.createComponent(OeeReports);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
