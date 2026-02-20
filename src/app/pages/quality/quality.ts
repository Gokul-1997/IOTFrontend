import { Component, ViewChild } from '@angular/core';
import { IconComponent } from '../../shared/icon/icon';

import {
  NgApexchartsModule,  
  ChartComponent,
  ApexAxisChartSeries,
  ApexChart,
  ApexXAxis,
  ApexYAxis,
  ApexDataLabels,
  ApexTooltip,
  ApexStroke,
  ApexFill,
  ApexLegend
  
} from "ng-apexcharts";



export type hourWisePerformChartOptions = {
  series: ApexAxisChartSeries;
  chart: ApexChart;
  xaxis: ApexXAxis;
  yaxis: ApexYAxis;
  stroke: ApexStroke;
  tooltip: ApexTooltip;
  dataLabels: ApexDataLabels;
  fill: ApexFill;
  legend: ApexLegend;
  colors: string[];
};

@Component({
  selector: 'app-quality',
  standalone: true,
  imports: [IconComponent, NgApexchartsModule],
  templateUrl: './quality.html',
  styleUrl: './quality.scss',
})
export class Quality {

    @ViewChild("hourwiseperformChart") hourwiseperformChart!: ChartComponent;  
    public hourPerformOptions!: hourWisePerformChartOptions;

    constructor() {

////////////////////////////////////////////////
// Hour Perform Chart
////////////////////////////////////////////////

    this.hourPerformOptions = {

series: [
  {
    name: "OEE",
    data: [5, 85, 92, 78, 60, 58, 68, 50, 55]
  },
  {
    name: "Availability",
    data: [3, 30, 38, 30, 25, 30, 28, 30, 32]
  },
  {
    name: "Performance",
    data: [2, 35, 48, 45, 47, 52, 57, 58, 48]
  },
  {
    name: "Quality",
    data: [4, 55, 63, 35, 23, 35, 33, 15, 25]
  }
],

chart: {
  type: "area",
  height: 350,
  toolbar: { show: false }
},

colors: [
  "#1E3A5F", // OEE dark blue
  "#22C55E", // Availability green
  "#0EA5E9", // Performance blue
  "#8B5CF6"  // Quality purple
],

dataLabels: {
  enabled: false
},

stroke: {
  curve: "smooth",
  width: 3
},

// ✅ KEEP YOUR GRADIENT EFFECT
fill: {
  type: "gradient",
  gradient: {
    shadeIntensity: 1,
    opacityFrom: 0.45,
    opacityTo: 0.1,
    stops: [0, 90, 100]
  }
},

xaxis: {

  title: {
    text: "Hour"
  },

  categories: [
    "09:00 AM",
    "10:00 AM",
    "11:00 AM",
    "12:00 PM",
    "01:00 PM",
    "02:00 PM",
    "03:00 PM",
    "04:00 PM",
    "05:00 PM"
  ]

},

yaxis: {

  min: 0,
  max: 100,

  title: {
    text: "Percentage"
  },

  labels: {
    formatter: (val) => val + "%"
  }

},

tooltip: {

  y: {
    formatter: (val) => val + "%"
  }

},

legend: {
  position: "bottom"
}

};
  }

  public generateData(
  baseval: number,
  count: number,
  yrange: { min: number; max: number }
): number[][] {
    var i = 0;
    var series = [];
    while (i < count) {
      var x = Math.floor(Math.random() * (750 - 1 + 1)) + 1;
      var y =
        Math.floor(Math.random() * (yrange.max - yrange.min + 1)) + yrange.min;
      var z = Math.floor(Math.random() * (75 - 15 + 1)) + 15;

      series.push([x, y, z]);
      baseval += 86400000;
      i++;
    }
    return series;
  }


}
