import { Component,EventEmitter,Output,OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { JobService } from './job.service';

@Component({
 standalone:true,
 selector:'app-job-create-modal',
 imports:[CommonModule,FormsModule],
 templateUrl:'./job-create-modal.component.html'
})
export class JobCreateModalComponent implements OnInit{

 @Output() close = new EventEmitter();

 form:any={};

 machines:any[]=[];
//  operators:any[]=[];
 components:any[]=[];

 constructor(private service:JobService){}

 ngOnInit(){
   this.loadData();
 }

 loadData(){

   this.service.getMachines().subscribe((res:any)=>{
     this.machines = res.data;
   });

  //  this.service.getOperators().subscribe((res:any)=>{
  //    this.operators = res.data;
  //  });

   this.service.getComponents().subscribe((res:any)=>{
     this.components = res.data;
   });

 }

 save(){

   this.service.startJob(this.form).subscribe(()=>{
     this.close.emit();
   });

 }

 cancel(){
   this.close.emit();
 }

}