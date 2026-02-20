import { Component } from "@angular/core";
import { IconComponent } from "../../shared/icon/icon";
import { NgApexchartsModule } from "ng-apexcharts";
import {
  ApexAxisChartSeries,
  ApexChart,
  ApexPlotOptions,
  ApexXAxis,
  ApexYAxis,
  ApexLegend,
  ApexFill,
  ApexDataLabels,
  ApexTooltip,
  ApexStroke,
  ApexGrid,
  ApexMarkers,
  ApexTitleSubtitle
} from "ng-apexcharts";

export type machineStatusChart = {
  series: ApexAxisChartSeries;
  chart: ApexChart;
  plotOptions: ApexPlotOptions;
  xaxis: ApexXAxis;
  yaxis: ApexYAxis;
  legend: ApexLegend;
  fill: ApexFill;
  dataLabels: ApexDataLabels;
  tooltip: ApexTooltip;
  colors: string[];
};

export type lineChart = {
  series: ApexAxisChartSeries;
  chart: ApexChart;
  colors: string[];
  dataLabels: ApexDataLabels;
  stroke: ApexStroke;
  grid: ApexGrid;
  markers: ApexMarkers;
  title: ApexTitleSubtitle;
  xaxis: ApexXAxis;
  yaxis: ApexYAxis;
  legend: ApexLegend;
  tooltip: ApexTooltip;
};

@Component({
  selector: "app-charts",
  standalone: true, 
  imports: [
    IconComponent,    
    NgApexchartsModule 
  ],

  templateUrl: "./charts.html",

})
export class Charts {

  public machineStatusChart: machineStatusChart;
  public partCountChart: lineChart;

  ////////////////////////////////////////////////
  // Machine Status Chart
  ////////////////////////////////////////////////
  constructor() {
    this.machineStatusChart = {
      series: [

{
          name: "Loading/Unloading Time",
          data: [60, 65, 63, 68, 70, 73, 76]
        },
        {
          name: "Cycle time",
          data: [90, 91, 92, 94, 95, 96, 97]
        }

        

      ],

      chart: {

        type: "bar",
        height: 350,
        stacked: false,
        stackType: "100%",
        toolbar: {
          show: true
        },
        zoom: {
    enabled: true
  }

      },

      colors: [
        "#FF5966",
        "#3B4CCA"
        
      ],

      plotOptions: {
        bar: {
          horizontal: false,
          columnWidth: "50%",
          borderRadius: 6,

          dataLabels: {
            position: "center"
          }
        }
      },

      dataLabels: {

      enabled: true,

      formatter: (val: number) => `${Math.round(val)}%`,

      style: {
        colors: ["#fff"]
      },
    },

      xaxis: {

        categories: [
          "Part 1",
          "Part 2",
          "Part 3",
          "Part 4",
          "Part 5",
          "Part 6",
          "Part 7"
        ]

      },

      yaxis: {

        min: 0,
        max: 100,

        title: {
          text: "Percentage"
        }

      },

      legend: {

        position: "bottom"

      },
      

      fill: {

        opacity: 1

      },

      tooltip: {

        y: {

          formatter: function(val) {

            return val + "%";

          }

        }

      }

    };

////////////////////////////////////////////////
// Part Count Chart
////////////////////////////////////////////////

    this.partCountChart = {

  series: [
    {
      name: "Target",
      data: [28, 29, 33, 36, 32, 32, 33]
    },
    {
      name: "Produced",
      data: [28, 30, 14, 18, 17, 13, 13]
    }
  ],

  chart: {
    height: 350,
    type: "line",
    toolbar: {
      show: false
    },
    zoom: {
      enabled: false
    },
    dropShadow: {
      enabled: true,
      color: "#000",
      top: 18,
      left: 7,
      blur: 10,
      opacity: 0.5
    }
  },

  colors: ['#77B6EA', '#545454'],

  dataLabels: {
    enabled: true
  },

  stroke: {
    curve: "smooth",
    width: 3
  },

  title: {
    text: ""
  },

  grid: {
    borderColor: "#e7e7e7"
  },

  markers: {
    size: 4
  },

  xaxis: {
    categories: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul']
  },

  yaxis: {
    min: 5,
    max: 40,
    title: {
      text: "Temperature"
    }
  },

  legend: {
    position: "bottom"
  },

  tooltip: {
    y: {
      formatter: (val) => val + "°C"
    }
  }

};

  }

}