import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { JobService } from './job.service';
import { JobCreateModalComponent } from './job-create-modal.component';

@Component({
  standalone: true,
  selector: 'app-job-list',
  imports: [CommonModule, JobCreateModalComponent],
  templateUrl: './job-list.component.html'
})
export class JobListComponent implements OnInit {

  jobs:any[]=[];
  showModal=false;

  constructor(private service:JobService){}

  ngOnInit(){
    this.load();
  }

  load(){
    this.service.getJobs().subscribe((res:any)=>{
      this.jobs = res.data || [];
    });
  }

  openCreate(){
    this.showModal=true;
  }

  closeModal(){
    this.showModal=false;
    this.load();
  }

  stop(machine_id:number){
    this.service.stopJob(machine_id).subscribe(()=>{
      this.load();
    });
  }

}