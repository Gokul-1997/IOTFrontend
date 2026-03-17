import {
  Component,
  OnInit,
  OnDestroy,
  NgZone,
  ChangeDetectorRef
} from '@angular/core';

import { ActivatedRoute } from '@angular/router';
import { NgApexchartsModule } from 'ng-apexcharts';
import { DashboardService } from '../dashboard.service';
import { SocketService } from '../../../core/services/socket.service';
import { Subject, takeUntil } from 'rxjs';
import { CommonModule } from '@angular/common';

@Component({
  standalone: true,
  selector: 'app-live',
  imports: [NgApexchartsModule, CommonModule],
  templateUrl: './live.component.html'
})
export class LiveComponent implements OnInit, OnDestroy {

  private destroy$ = new Subject<void>();

  machineId!: number;

  machine:any={}
  operator:any={}
  job:any={}
  oee:any={}
  shift:any={}

  quality:any={}
  power:any={}

  liveStatus='UNKNOWN'
  liveRPM=0
  liveFeed=0

  runTime='00:00:00'
  idleTime='00:00:00'

  utilization=0

  currentDate=new Date()

  utilSeries=[0]
  oeeSeries=[0]
  spindleSeries=[0]
  feedSeries=[0]
  timePieSeries=[0,0]

  utilChart:any
  oeeChart:any
  spindleChart:any
  feedChart:any
  timePieChart:any

  constructor(
    private route:ActivatedRoute,
    private dashboardService:DashboardService,
    private socketService:SocketService,
    private zone:NgZone,
    private cdr:ChangeDetectorRef
  ){}

  ngOnInit(){

    const id=this.route.snapshot.paramMap.get('id')
    this.machineId=Number(id)

    this.initCharts()

    this.loadMachine()

    this.socketService.onMachineUpdate((data:any)=>{
      this.handleSocket(data)
    })

  }

  ngOnDestroy(){
    this.destroy$.next()
    this.destroy$.complete()
  }

  loadMachine(){

    this.dashboardService
      .getMachineDetail(this.machineId)
      .pipe(takeUntil(this.destroy$))
      .subscribe((res:any)=>{

        const d=res.data

        this.machine=d.machine
        this.operator=d.operator
        this.job=d.job
        this.oee=d.oee
        this.shift=d.shift

        this.quality=d.quality || {}
        this.power=d.power || {}

        this.runTime=d.production.run_time
        this.idleTime=d.production.idle_time

        this.liveStatus=d.live.machine_status
        this.liveRPM=d.live.rpm
        this.liveFeed=d.live.feed_rate

        this.utilization=d.utilization || 0

        this.utilSeries=[this.utilization]
        this.oeeSeries=[Number(this.oee?.oee || 0)]

        this.updateTimePie()

        this.cdr.markForCheck()

      })

  }

  handleSocket(data:any){

    if(data.machine_id!==this.machineId) return

    this.zone.run(()=>{

      if(data.machine_status!==undefined)
        this.liveStatus=data.machine_status

      if(data.rpm!==undefined){
        this.liveRPM=data.rpm
        this.spindleSeries=[Math.min((data.rpm/3000)*100,100)]
      }

      if(data.feed_rate!==undefined){
        this.liveFeed=data.feed_rate
        this.feedSeries=[Math.min((data.feed_rate/100)*100,100)]
      }

      if(data.run_time!==undefined)
        this.runTime=data.run_time

      if(data.idle_time!==undefined)
        this.idleTime=data.idle_time

      if(data.utilization!==undefined){
        this.utilization=data.utilization
        this.utilSeries=[data.utilization]
      }

      this.updateTimePie()

      this.currentDate=new Date()

      this.cdr.markForCheck()

    })

  }

  timeToSec(t:string){

    if(!t) return 0

    const p=t.split(':').map(Number)

    return p[0]*3600+p[1]*60+p[2]

  }

  updateTimePie(){

    const r=this.timeToSec(this.runTime)
    const i=this.timeToSec(this.idleTime)

    const total=r+i

    if(total===0){
      this.timePieSeries=[0,0]
      return
    }

    this.timePieSeries=[
      Number(((r/total)*100).toFixed(1)),
      Number(((i/total)*100).toFixed(1))
    ]

  }

  initCharts(){

    this.utilChart={
      chart:{type:'radialBar',height:220},
      plotOptions:{
        radialBar:{
          startAngle:-135,
          endAngle:135,
          hollow:{size:'70%'},
          dataLabels:{name:{show:false}}
        }
      }
    }

    this.oeeChart={
      chart:{type:'radialBar',height:240},
      plotOptions:{
        radialBar:{
          startAngle:-135,
          endAngle:135,
          hollow:{size:'70%'},
          dataLabels:{name:{show:false}}
        }
      }
    }

    this.spindleChart={
      chart:{type:'radialBar',height:200},
      plotOptions:{
        radialBar:{
          startAngle:-90,
          endAngle:90,
          hollow:{size:'65%'},
          dataLabels:{name:{show:false}}
        }
      }
    }

    this.feedChart={
      chart:{type:'radialBar',height:200},
      plotOptions:{
        radialBar:{
          startAngle:-90,
          endAngle:90,
          hollow:{size:'65%'},
          dataLabels:{name:{show:false}}
        }
      }
    }

    this.timePieChart={
      chart:{type:'pie',height:260},
      labels:['Running','Idle'],
      colors:['#1E88E5','#1BC98E'],
      legend:{position:'right'},
      dataLabels:{
        formatter:(v:any)=>`${v.toFixed(1)}%`
      }
    }

  }

}