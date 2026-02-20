import { CommonModule } from '@angular/common';
import { Component, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../../../shared/icon/icon';

import {
  NgApexchartsModule,
  ChartComponent,
  ApexNonAxisChartSeries,
  ApexAxisChartSeries,
  ApexPlotOptions,
  ApexXAxis,
  ApexChart,
  ApexDataLabels,
  ApexFill,
  ApexYAxis,
  ApexStroke,
  ApexLegend,
  ApexTooltip,
  ApexGrid
} from "ng-apexcharts";


export type RadialChartOptions = {
  series: ApexNonAxisChartSeries;
  chart: ApexChart;
  labels: string[];
  plotOptions: ApexPlotOptions;
  fill: ApexFill;
  stroke: ApexStroke;
};
export type oeeChartOptions = {
  series: ApexNonAxisChartSeries;
  chart: ApexChart;
  labels: string[];
  plotOptions: ApexPlotOptions;
  fill: ApexFill;
  stroke: ApexStroke;
  colors?: string[];
};

export type TimelineChartOptions = {
  series: ApexAxisChartSeries;
  chart: ApexChart;
  plotOptions: ApexPlotOptions;
  xaxis: ApexXAxis;
  tooltip: ApexTooltip;
  colors?: string[];
};

export type spindleChartOptions = {
   series: ApexNonAxisChartSeries;
  chart: ApexChart;
  plotOptions: ApexPlotOptions;
  fill: ApexFill;
  labels: string[];
};

export type apChartOptions = {
  series: ApexAxisChartSeries;
  chart: ApexChart;
  dataLabels: ApexDataLabels;
  plotOptions: ApexPlotOptions;
  yaxis: ApexYAxis;
  xaxis: ApexXAxis;
  grid: ApexGrid;
  colors: string[];
  legend: ApexLegend;
};


@Component({
  selector: 'app-live',
  imports: [CommonModule, FormsModule, IconComponent, NgApexchartsModule],
  templateUrl: './live.component.html',
  styleUrl: './live.component.scss',
})
export class LiveComponent {
  runningprogress = 63;
  public spindleValue = 20;
  public spindleNeedleAngle = 0;

  @ViewChild("radialChart") radialChart!: ChartComponent;
  @ViewChild("lineChart") lineChart!: ChartComponent;
  @ViewChild("spindleChart") spindleChart!: ChartComponent;
  @ViewChild("oeeChart") oeeChart!: ChartComponent;
  @ViewChild("apChart") apChart!: ChartComponent;

  public radialOptions!: RadialChartOptions;
  public timelineOptions!: TimelineChartOptions;
  public spindleOptions!: spindleChartOptions;
  public oeeOptions!: oeeChartOptions;
  public apOptions!: apChartOptions;

  
  
  constructor() {
    ////////////////////////////////////////////////
    /// Utilization Chart start
    ////////////////////////////////////////////////
    this.radialOptions = {
    series: [10],
    chart: {
      width:200,
      height: 200,
      type: "radialBar"
    },
    labels: ["Utilization"],
    plotOptions: {
    radialBar: {
      startAngle: -135,
      endAngle: 135,
      hollow: {
        size: "40%"
      },
      track: {
        show: true,
      background: '#e5e5e5', // Track color
      strokeWidth: '100%',   // Width relative to chart
      opacity:.5,
      margin: 5,             // Space between track and bar
      },
      dataLabels: {
        name: {
          show: true,
          offsetY: 70,
          fontSize: "10px"
        },
        value: {
          show: true, 
          fontSize: "28px",
          fontWeight: "bold",
          offsetY: 40,
          formatter: function (val) {
            return val + "%";
          }
        }
      }

    }
  },

  fill: {
    type: "solid",
    colors: ["#3B4CCA"]
  },

  stroke: {
    dashArray: 4
  }

};
////////////////////////////////////////////////
/// Oee Chart
////////////////////////////////////////////////
    this.oeeOptions = {
    series: [10],
    chart: {
      width:250,
      height: 250,
      type: "radialBar"
    },
    labels: ["OEE"],
    plotOptions: {
    radialBar: {
      startAngle: -135,
      endAngle: 135,
      hollow: {
        size: "40%"
      },
      track: {
        show: true,
      background: '#e5e5e5', // Track color
      strokeWidth: '100%',   // Width relative to chart
      opacity:.5,
      margin: 5,             // Space between track and bar
      },
      dataLabels: {
        name: {
          show: true,
          offsetY: 70,
          fontSize: "10px"
        },
        value: {
          show: true, 
          fontSize: "28px",
          fontWeight: "bold",
          offsetY: 40,
          formatter: function (val) {
            return val + "%";
          }
        }
      }

    }
  },

  fill: {
    type: "solid",
    colors: ["#3B4CCA"]
  },

  stroke: {
    dashArray: 4
  }

};
////////////////////////////////////////////////
// Timeline Chart
////////////////////////////////////////////////
this.timelineOptions = {
  series: [
    {
      name: "Machine asdasd",

      data: [

        // Running
        {
          x: "Machine",
          y: [
            new Date().setHours(9, 0, 0),
            new Date().setHours(10, 0, 0)
          ],
          fillColor: "#16a34a",
          status: "Running"
        },

        // Scheduled Break
        {
          x: "Machine",
          y: [
            new Date().setHours(10, 0, 0),
            new Date().setHours(10, 15, 0)
          ],
          fillColor: "#f59e0b",
          status: "Scheduled Break"
        },

        // Running
        {
          x: "Machine",
          y: [
            new Date().setHours(10, 15, 0),
            new Date().setHours(12, 0, 0)
          ],
          fillColor: "#16a34a",
          status: "Running"
        },

        // Scheduled Break
        {
          x: "Machine",
          y: [
            new Date().setHours(12, 0, 0),
            new Date().setHours(13, 0, 0)
          ],
          fillColor: "#f59e0b",
          status: "Scheduled Break"
        },

        // Machine Off
        {
          x: "Machine",
          y: [
            new Date().setHours(13, 0, 0),
            new Date().setHours(13, 15, 0)
          ],
          fillColor: "#ef4444",
          status: "Machine Off"
        },
        // Running
        {
          x: "Machine",
          y: [
            new Date().setHours(13, 15, 0),
            new Date().setHours(16, 0, 0)
          ],
          fillColor: "#16a34a",
          status: "Running"
        },
        // Machine Off
        {
          x: "Machine",
          y: [
            new Date().setHours(16, 0, 0),
            new Date().setHours(16, 15, 0)
          ],
          fillColor: "#ef4444",
          status: "Machine Off"
        },
         // Running
        {
          x: "Machine",
          y: [
            new Date().setHours(16, 15, 0),
            new Date().setHours(18, 0, 0)
          ],
          fillColor: "#16a34a",
          status: "Running"
        },

      ]
    }
  ],


  chart: {
    type: "rangeBar",
    height: 130,
    toolbar: { show: false }
  },


  plotOptions: {

    bar: {

      horizontal: true,

      barHeight: "70%"

    }

  },


  xaxis: {

  type: "datetime",

  min: new Date().setHours(9, 0, 0),

  max: new Date().setHours(18, 0, 0),

  tickAmount: 9,

  labels: {

    formatter: function(value) {

      return new Date(value).toLocaleTimeString([], {

        hour: "numeric",
        hour12: true   // ✅ THIS enables AM PM

      });

    }

  }

},


tooltip: {

  custom: function(opts: any) {

    const dp =
      opts.w.globals.initialSeries[opts.seriesIndex]
      .data[opts.dataPointIndex];


    const start =
      new Date(dp.y[0]).toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
        hour12: true
      });

      const end =
      new Date(dp.y[1]).toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
        hour12: true
      });


    const duration =
      (dp.y[1] - dp.y[0]) / 60000;


    return `

      <div style="
      padding:10px;
      background:white;
      border-radius:8px;
      
      ">

        <div style="
          font-size:18px;
          font-weight:bold
        ">

          ${duration} Minutes

        </div>


        <div style="
          color:#64748b;
          font-size:13px
        ">

          ${dp.status}

        </div>


        <div style="
          font-size:13px
        ">

          ${start} - ${end}

        </div>

      </div>

    `;
  }

}

};

////////////////////////////////////////////////
// Spindl Chart
////////////////////////////////////////////////
this.spindleOptions = {
  
      series: [20],
      chart: {
        type: "radialBar",
        offsetY: -20
      },
      plotOptions: {
        radialBar: {
          startAngle: -90,
          endAngle: 90,
          track: {
            background: "#e7e7e7",
            strokeWidth: "97%",
            margin: 5, // margin is in pixels
            dropShadow: {
              enabled: true,
              top: 2,
              left: 0,
              opacity: 0.31,
              blur: 2
            }
          },
          dataLabels: {
            name: {
              show: false
            },
            value: {
              offsetY: 2,
              fontSize: "22px"
            }
          },
          hollow: {
          size: "60%"
        }
        }
      },
      fill: {
        type: "gradient",
        gradient: {
          shade: "light",
          shadeIntensity: 0.4,
          inverseColors: false,
          opacityFrom: 1,
          opacityTo: 1,
          stops: [0, 50, 53, 91]
        }
      },
      labels: ["Average Results"]
    };
    this.updateSpindleNeedle(this.spindleValue);

    this.apOptions = {
  series: [
    {
      name: "Distributed",
      data: [21, 22, 10]
    }
  ],

  chart: {
    height: 200,
    width:250,
    type: "bar",
    toolbar: {
      show: false
    }
  },

  colors: ["#3B4CCA", "#0CAD5D", "#FF5966"],

  plotOptions: {
    bar: {
      columnWidth: "45%",
      distributed: true,
      borderRadius: 4,          // optional nice look
      dataLabels: {
        position: "top"         // ✅ label on top
      }
    }
  },

  dataLabels: {
    enabled: true,              // ✅ show values
    offsetY: -20,
    style: {
      fontSize: "12px",
      colors: ["#000"]
    },
    formatter: function (val) {
      return val;
    }
  },

  grid: {
    show: true,                 // ✅ show grid lines
    borderColor: "#e5e7eb",
    strokeDashArray: 4,
    yaxis: {
      lines: {
        show: true
      }
    }
  },

  yaxis: {
    min: 0,
    max: 30,                    // ✅ ensures line at 30
    tickAmount: 3,              // ✅ creates 10,20,30 steps
    labels: {
      formatter: function(val) {
        return val.toFixed(0);
      }
    }
  },

  xaxis: {
    categories: [
      ["Expected"],
      ["Good"],
      ["Bad"]
    ]
  },

  legend: {
    show: false
  }
};

  }

  updateSpindleNeedle(value: number) {
  // Semi gauge range = -90 to +90
  // total = 180 degree
  this.spindleNeedleAngle = (value * 180) / 100 - 90;
  }

}
