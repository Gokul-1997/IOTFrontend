/*
 * What each number on the shop-floor screens means, in plain words, with the
 * formula the backend actually uses and a worked example.
 *
 * Keep these in step with the calculations:
 *   - Backend/src/dashboard/oee.dashboard.service.js (deriveOee): the period
 *     dashboards — planned time is every hour the machine reported.
 *   - Backend/src/lib/oee.js, quality.service.js, dashboard.service.js: the
 *     shift screens — planned time is the shift length minus its breaks.
 * Both: good parts = made − rejected − rework; performance needs the cycle
 * time of the component on the machine's job and is capped at 100 %.
 *
 * One worked example runs through every topic so the numbers agree with each
 * other: a 12-hour shift with a 1-hour break (660 planned minutes), 495
 * minutes running, a 2-minute cycle, 198 parts made, 6 rejected, 2 rework.
 *   Availability 495 ÷ 660 = 75 %
 *   Performance  198 ÷ (495 ÷ 2 = 247.5) = 80 %
 *   Quality      190 ÷ 198 = 96 %
 *   OEE          75 % × 80 % × 96 % = 57.6 %
 */

/** Which planned time a screen uses. */
export type HelpBasis = 'shift' | 'period';

export interface MetricHelpEntry {
  title: string;
  /** One or two short sentences: what the number is. */
  what: string;
  /** The calculation, one line each. */
  formula?: string[];
  example?: string;
  why?: string;
}

const PLANNED: Record<HelpBasis, string> = {
  shift:  'Planned time is the shift length minus its breaks.',
  period: 'Planned time is every hour the machine was switched on and sending data in the period you selected.'
};

/* With no cycle time on the job, Performance cannot be worked out: the
   period dashboards leave it out ("--"), the shift screens count it as 0. */
const NO_CYCLE: Record<HelpBasis, string> = {
  period: 'If the job has no cycle time set, Performance and OEE show "--". Add the cycle time to the component to see them.',
  shift:  'If the job has no cycle time set, Performance and OEE show 0 %. Add the cycle time to the component to see them.'
};

export function metricHelp(topic: string, basis: HelpBasis = 'period'): MetricHelpEntry {
  switch (topic) {
    case 'oee':
      return {
        title: 'OEE (Overall Equipment Effectiveness)',
        what: 'One score for how well a machine was used. It combines three things: was it running (Availability), was it running at full speed (Performance), and were the parts good (Quality).',
        formula: ['OEE = Availability × Performance × Quality'],
        example: 'Availability 75 % × Performance 80 % × Quality 96 % = OEE 57.6 %.',
        why: '85 % or more is good. 60–85 % is fair. Below 60 % needs attention. Look at the lowest of the three to see where time is lost. ' + NO_CYCLE[basis]
      };
    case 'availability':
      return {
        title: 'Availability',
        what: 'How much of the planned time the machine was actually running a program.',
        formula: ['Availability = Run time ÷ Planned time', PLANNED[basis]],
        example: basis === 'shift'
          ? 'A 12-hour shift with a 1-hour break = 660 planned minutes. The machine ran 495 minutes. 495 ÷ 660 = 75 %.'
          : 'The machine sent data for 11 hours = 660 planned minutes. It ran 495 minutes. 495 ÷ 660 = 75 %.',
        why: 'Low availability means the machine was stopped: breakdowns, waiting for material, setups or no operator.'
      };
    case 'performance':
      return {
        title: 'Performance',
        what: 'How fast the machine made parts while it was running, compared with the cycle time set for the part.',
        formula: [
          'Performance = Parts made ÷ Parts possible',
          'Parts possible = Run time ÷ Cycle time (× parts per cycle, if the fixture holds more than one)',
          'It never shows more than 100 %.'
        ],
        example: 'Ran 495 minutes with a 2-minute cycle: 495 ÷ 2 = 247.5 parts possible. It made 198. 198 ÷ 247.5 = 80 %.',
        why: 'Low performance means slow cycles or many short stops. ' + NO_CYCLE[basis]
      };
    case 'quality':
      return {
        title: 'Quality',
        what: 'How many of the parts made were good.',
        formula: ['Quality = Good parts ÷ Parts made', 'Good parts = Parts made − Rejected − Rework'],
        example: '198 made, 6 rejected and 2 sent for rework: 190 good. 190 ÷ 198 = 96 %.',
        why: 'Rejected and rework parts cost material and machine time. Quality stays at 100 % until someone enters rejected or rework counts on the Quality page.'
      };
    case 'run_time':
      return {
        title: 'Run time',
        what: 'Time the machine was running a program (cutting or moving), as reported by the machine itself.',
        example: 'If the machine ran 8 hours 15 minutes in the shift, run time is 8h 15m (495 minutes).',
        why: 'Run time is the top half of Availability. More run time in the same planned time means higher availability.'
      };
    case 'idle_time':
      return {
        title: 'Idle time (downtime)',
        what: 'Time the machine was switched on but not running a program — waiting, setting up, loading parts or stopped by an alarm. The machine measures this itself.',
        formula: ['Idle time = time switched on − run time'],
        example: 'Switched on for 11 hours, ran 8h 15m: idle time is 2h 45m.',
        why: 'Idle time is lost production. Entering a reason for each stop (Downtime page) shows which causes cost the most.'
      };
    case 'downtime_reasons':
      return {
        title: 'Downtime by reason',
        what: 'Stops that a person recorded with a reason, such as Breakdown, Tea break or Material change. These are entered on the Downtime page.',
        example: 'Three stops recorded as "Material change" for 20, 25 and 15 minutes show here as 60 minutes of Material change.',
        why: 'This shows which causes take the most time, so you know what to fix first. If no reasons are entered, this stays empty even when the machine was idle.'
      };
    case 'produced':
      return {
        title: 'Parts produced',
        what: 'Parts counted by the machine\'s own part counter in the period, including any later found to be rejected or reworked.',
        example: 'The counter went up 198 times during the shift: parts produced = 198.',
        why: 'This is the figure Performance and Quality are worked out from.'
      };
    case 'target':
      return {
        title: 'Target',
        what: 'The number of parts planned for the job running on the machine. It is set when the job is started on the Job page.',
        example: 'Target 250 and 198 made: 52 parts still to make.',
        why: 'Comparing parts made with the target shows whether the job will finish on time.'
      };
    case 'accepted':
      return {
        title: 'Accepted (good parts)',
        what: 'Parts made that passed inspection.',
        formula: ['Accepted = Parts made − Rejected − Rework'],
        example: '198 made, 6 rejected, 2 rework: 190 accepted.',
        why: 'Only accepted parts count towards Quality.'
      };
    case 'rejected':
      return {
        title: 'Rejected',
        what: 'Parts that failed inspection and cannot be used. Entered on the Quality page.',
        example: '6 rejected out of 198 made.',
        why: 'Each rejected part lowers Quality and wastes material and machine time.'
      };
    case 'rework':
      return {
        title: 'Rework',
        what: 'Parts that failed inspection but can be corrected. Entered on the Quality page.',
        example: '2 sent for rework out of 198 made.',
        why: 'Rework parts are not counted as good, so they lower Quality until they are fixed and re-counted.'
      };
    case 'utilization':
      return {
        title: 'Utilisation',
        what: 'How far the machine has got with its job in this shift.',
        formula: [
          'With a target set: Utilisation = Parts made ÷ Target',
          'With no target: Utilisation = Run time ÷ Planned time (shift length minus breaks)',
          'It never shows more than 100 %.'
        ],
        example: 'Target 60 parts, 35 made: 35 ÷ 60 = 58 %. No target, ran 330 of 660 planned minutes: 50 %.',
        why: 'A low figure late in the shift means the job will not finish on time.'
      };
    case 'running_share':
      return {
        title: 'Utilisation (running share)',
        what: 'Of the time the machines were switched on, the share they spent running a program.',
        formula: ['Utilisation = Run time ÷ (Run time + Idle time)'],
        example: 'Run 8h 15m and idle 2h 45m: 495 ÷ (495 + 165) minutes = 75 %.',
        why: 'The rest of the switched-on time was idle: waiting, setting up or stopped by an alarm. It shows "--" when no machine sent data.'
      };
    case 'production_vs_target':
      return {
        title: 'Production against target',
        what: 'Parts made by machines that have a job target, as a share of those targets added together.',
        formula: ['Production % = Parts made ÷ Total target'],
        example: 'Targets 1,000 and 726 (1,726 in all), 548 made: 548 ÷ 1,726 = 31.7 %.',
        why: 'Shows how far the planned jobs have got. When no machine has a job target, the plain count of parts is shown instead.'
      };
    case 'machine_status':
      return {
        title: 'Machine status',
        what: 'Running: cutting or moving now. Idle: switched on but not running a program. Breakdown: switched on with an alarm. Offline: no data from the machine for over a minute (switched off or disconnected).',
        example: '20 machines: 4 running, 13 idle, 0 in breakdown, 3 offline.',
        why: 'Idle and breakdown machines are where production is being lost right now.'
      };
    case 'onoff_availability':
      return {
        title: 'Availability (this page)',
        what: 'Of the time the machines were switched on, the share they spent running a program. On this page it leaves out time the machines were switched off.',
        formula: ['Availability = Run time ÷ (Run time + Idle time)'],
        example: 'Run 8h 15m, idle 2h 45m: 495 ÷ 660 minutes = 75 %.',
        why: 'The OEE screens divide by planned time instead, so their Availability can be a little different for the same machines.'
      };
    case 'declared_downtime':
      return {
        title: 'Recorded downtime',
        what: 'Stop time that people recorded on the Downtime page, with a reason. Stops still open count up to now.',
        example: 'Three stops of 20, 25 and 15 minutes recorded: 1 hour of downtime.',
        why: 'Compare it with Idle time. Idle time the machine measured but nobody recorded is shown as "unaccounted" — the stops whose cause is unknown.'
      };
    case 'unaccounted':
      return {
        title: 'Unaccounted idle time',
        what: 'Idle time the machines measured that has no recorded reason.',
        formula: ['Unaccounted = Idle time − Recorded downtime'],
        example: 'Idle 2h 45m, recorded 1h: 1h 45m unaccounted.',
        why: 'The smaller this is, the more you know about why machines stop.'
      };
    case 'alarm_time':
      return {
        title: 'Alarm time',
        what: 'How long machines had an alarm on, from when each alarm started to when it cleared. Only the part inside the selected period is counted.',
        example: 'An alarm from 10:40 to 11:10 counts as 30 minutes.',
        why: 'Long alarm time points to machine faults that need maintenance.'
      };
    case 'mttr':
      return {
        title: 'MTTR (Mean Time To Repair)',
        what: 'The average time from a maintenance ticket being raised to it being resolved. Only resolved tickets are counted.',
        formula: ['MTTR = Total repair time ÷ Number of resolved tickets'],
        example: 'Three tickets resolved in 2, 3 and 4 hours: (2 + 3 + 4) ÷ 3 = 3 hours.',
        why: 'A lower MTTR means machines come back into production faster after a fault.'
      };
    case 'run_hours':
      return {
        title: 'Run hours',
        what: 'The run time of every row in the table added together, in hours.',
        formula: ['Run hours = Total run time ÷ 60 minutes'],
        example: 'Two machines ran 5h 30m and 3h: 8.50 hours.',
        why: 'More run hours from the same machines and shifts means more of the planned time was used.'
      };
    case 'energy_total':
      return {
        title: 'Total energy',
        what: 'The energy figures of every row in the table added together, in kilowatt-hours (kWh).',
        formula: ['Total energy = sum of each hour\'s energy'],
        example: 'Three hours at 4.2, 3.9 and 4.5 kWh: 12.6 kWh.',
        why: 'Compare it with parts made to see the energy each part costs. It stays at 0 when the machines send no energy readings.'
      };
    case 'energy_consumed':
      return {
        title: 'Energy consumed',
        what: 'Electricity the machines used in the period, in kilowatt-hours (kWh), from each machine\'s own energy counter.',
        formula: ['Energy used = last counter reading − first, day by day, added up'],
        example: 'A counter at 1,200.0 kWh in the morning and 1,262.5 kWh at night: 62.5 kWh used that day.',
        why: 'A machine whose device sends no energy counter shows "not reporting", never 0 — it is left out of the total, not counted as using nothing.'
      };
    case 'energy_cost':
      return {
        title: 'Total energy cost',
        what: 'What the energy used in the period cost, at the tariff set on Master → Tariff & Rates (₹ per unit, kWh).',
        formula: ['Energy cost = kWh used × ₹ per kWh'],
        example: '1,248.6 kWh at ₹10.95 per kWh: ₹13,672.',
        why: 'A machine with a rate of its own is priced at that rate; every other machine at the company default. With no tariff set, cost shows "--".'
      };
    case 'energy_per_part':
      return {
        title: 'Energy per part',
        what: 'How much energy each part took, on average, over the period.',
        formula: ['Energy per part = kWh used ÷ parts made'],
        example: '1,248.6 kWh for 12,560 parts: 0.099 kWh per part.',
        why: 'Lower is better. A rise means the machines used more energy for the same output — idle running, heavier cuts or a fault.'
      };
    case 'avg_voltage':
      return {
        title: 'Average voltage',
        what: 'The supply voltage sent with the machines\' readings, between phases (line to line), averaged over the period.',
        example: 'About 415 V is normal for a 3-phase supply; phase to neutral it would read about 240 V.',
        why: 'A supply well above or below 415 V strains motors and drives. Shows "--" when no machine sends a voltage.'
      };
    case 'avg_current':
      return {
        title: 'Average current',
        what: 'The current sent with the machines\' readings, per phase, averaged over the period.',
        why: 'A machine drawing much more current than usual for the same work can point to a mechanical or electrical problem. Shows "--" when no machine sends a current.'
      };
    case 'overload':
      return {
        title: 'Overload alerts',
        what: 'Machines whose power went above their overload limit (kW) in the period. The tile names the one furthest over.',
        formula: ['Overload = peak kW above the limit set on Master → Tariff & Rates'],
        example: 'A limit of 12 kW and a peak of 15.2 kW: 3.2 kW over.',
        why: 'Repeated overloads strain the motor and the supply. No limit set means no alert.'
      };
    case 'energy_cost_trend':
      return {
        title: 'Energy cost trend',
        what: 'Energy used each day, week or month, priced at the company tariff. With no tariff set, the bars show kWh instead.',
        formula: ['Cost of a bar = kWh in it × ₹ per kWh'],
        why: 'Weeks are the days of each week added together; switching Day, Week or Month does not reload the page.'
      };
    case 'oee_loss':
      return {
        title: 'Where OEE is lost',
        what: 'Every planned hour, split into good output (OEE) and the three ways time is lost.',
        formula: ['Availability loss: planned, but not running — idle, or off and sending no data',
                  'Performance loss: running slower than the ideal cycle time',
                  'Quality loss: parts rejected or reworked'],
        example: 'Availability 89 %, Performance 88 %, Quality 96 %: 11 pts lost to availability, 10.7 to performance, 3.1 to quality, 75.2 % good output.',
        why: 'The four parts add up to 100 % of planned time. The biggest loss is where to look first.'
      };
    case 'oee_trend':
      return {
        title: 'OEE trend',
        what: 'OEE for each day against the target line, with Availability, Performance and Quality behind it.',
        why: 'Click a name in the key to hide or show its line. A drop in OEE follows the factor that dropped with it.'
      };
    case 'operator_score':
      return {
        title: 'Operator score',
        what: 'One score per operator: the average of their machines\' utilisation, efficiency and quality rate.',
        formula: ['Score = (Utilisation + Efficiency + Quality rate) ÷ 3'],
        example: 'Utilisation 80 %, efficiency 75 %, quality 97 %: (80 + 75 + 97) ÷ 3 = 84 %.',
        why: 'A rate that was not measured is left out and the other two are averaged. Top 5 shows the highest scores, Bottom 5 the lowest.'
      };
    case 'rejection_rate':
      return {
        title: 'Rejection rate',
        what: 'The share of an operator\'s output that was rejected or reworked.',
        formula: ['Rejection rate = (Rejected + Rework) ÷ Parts made'],
        example: '10 rejected and 2 reworked out of 420 parts: 2.9 %.',
        why: 'Lower is better, so Top 5 shows the highest rates: the operators to help first.'
      };
    case 'downtime_contribution':
      return {
        title: 'Downtime contribution',
        what: 'How long each operator\'s machines were switched on but not cutting.',
        why: 'Measured from the machines, not typed in, so it counts every stop whether or not a reason was entered. Top 5 shows the longest.'
      };
    case 'operator_rows':
      return {
        title: 'Operator rows',
        what: 'One row per operator, with the machines assigned to them in the period.',
        why: 'A machine with more than one assigned operator appears in each of their rows, so the rows can add up to more than the factory total.'
      };
    case 'efficiency':
      return {
        title: 'Efficiency',
        what: 'Of the time the machines were switched on, the share they spent running a program.',
        formula: ['Efficiency = Run time ÷ (Run time + Idle time)'],
        example: 'Run 8h 15m and idle 2h 45m: 495 ÷ 660 minutes = 75 %.',
        why: 'Time switched off is not counted, so this is higher than Availability on the OEE screens when machines were off for part of the shift.'
      };
    case 'avg_oee': case 'avg_availability': case 'avg_performance': case 'avg_quality': {
      const base = metricHelp(topic.slice(4), 'shift');
      const name = base.title.replace(/ \(.*\)$/, '');
      return {
        title: `Average ${name}`,
        what: `The average of the ${name} figures in the table below. Every row counts the same, whether the machine ran for the whole hour (or shift) or only a few minutes.`,
        formula: [`Average ${name} = sum of the rows' ${name} ÷ number of rows`],
        example: `Three rows at 60 %, 50 % and 70 %: (60 + 50 + 70) ÷ 3 = 60 %.`,
        why: `Good for comparing periods and machines. The OEE Dashboard works ${name} out from the total times and parts instead, so its figure can differ a little. What ${name} measures: ${base.what}`
      };
    }
    case 'spindle_load':
      return {
        title: 'Spindle load',
        what: 'How hard the spindle motor is working, as a share of the load it is rated for. The controller measures it.',
        formula: ['Up to 80 % is normal', '80–100 % is high', 'Over 100 % is an overload the motor can carry only for a short time'],
        example: '42 % means the motor is giving 42 % of its rated load. 118 % is an overload.',
        why: 'Long stretches above 80 % wear the spindle and the tools faster. Frequent overloads point to heavy cuts or blunt tools.'
      };
    case 'spindle_speed':
      return {
        title: 'Spindle speed',
        what: 'How fast the spindle turns, in revolutions per minute (rpm), as the controller reports it. It is compared with the machine\'s rated top speed from the machine register.',
        formula: ['Share of rated speed = Spindle speed ÷ Rated speed'],
        example: '2,500 rpm on a machine rated for 10,000 rpm is 25 % of its rated speed.',
        why: 'Speeds close to the rated top speed for long periods add wear. A speed of 0 means the spindle is stopped.'
      };
    case 'feed_rate':
      return {
        title: 'Feed rate',
        what: 'How fast the machine\'s axes move, in millimetres per minute (mm/min), as the controller reports it. It includes rapid moves between cuts, so the highest figure is usually a rapid move.',
        example: 'A cut at 1,200 mm/min moves the tool 1.2 metres in a minute.',
        why: 'The controller does not send the programmed feed or the feed override %, so the screen cannot say whether the operator slowed the feed down.'
      };
    default:
      return { title: topic, what: '' };
  }
}
