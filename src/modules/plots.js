import Plotly from 'plotly.js-dist';

function makePlot(data, elementId, ylabel, traceNames, eventInfo) {

    let lines = []
    let x = []
    for (let o of traceNames) {
        if (o != "ts") {
            lines.push({
                x: x,
                y: [],
                name: o,
            })
        }
    }
    for (const o of data) {
        let i = 0;
        for (let key of traceNames) {
            let value = o[key]
            lines[i].y.push(value)
            i++;
        }
        x.push(o.ts)
    }

    // lines.push(...eventInfoTraces)

    Plotly.newPlot(
        elementId,
        lines,
        {
            margin: { t: 20 },
            xaxis: { title: "Timestamp [s]" },
            yaxis: { title: ylabel },
            shapes: eventInfo.shapes,
            annotations: eventInfo.annotations,
            template: 'plotly_dark',
        }
    );
}

function makeEventInfoTraces(flightlog) {

    const ACTION_COLOR = "rgb(0, 0, 255)"
    const STATE_COLOR = "#ffa726"
    const EVENT_COLOR = "rgb(200, 0, 0)"
    const COLOR = "rgb(100, 100, 100)"

    const ACTION_MAP = {
        1: { name: "Delay", arguments: (x) => x + "ms", color: "red" },
        2: { name: "Pyro 1", arguments: (x) => ["OFF", "ON"][x], color: "rred" },
        3: { name: "Pyro 2", arguments: (x) => ["OFF", "ON"][x], color: "red" },
        4: { name: "IO 1", arguments: (x) => ["OFF", "ON"][x], color: "red" },
        5: { name: "Servo 1", arguments: (x) => x + "‰", color: "red" },
        6: { name: "Servo 2", arguments: (x) => x + "‰", color: "red" },
        7: { name: "Recorder", arguments: (x) => ["OFF", "PRE", "LOG"][x], color: "red" },
    }

    const EVENT_MAP = {
        1: { name: "ev_ready", color: COLOR },
        2: { name: "ev_liftoff", color: COLOR },
        3: { name: "ev_burnout", color: COLOR },
        4: { name: "ev_apogee", color: COLOR },
        5: { name: "ev_main_deployment", color: COLOR },
        6: { name: "ev_touchdown", color: COLOR },
        7: { name: "ev_custom1", color: COLOR },
        8: { name: "ev_custom2", color: COLOR },
    }

    const STATE_MAP = {
        1: { name: "CALIBRATING", color: COLOR },
        2: { name: "READY", color: COLOR },
        3: { name: "THRUST", color: COLOR },
        4: { name: "COAST", color: COLOR },
        5: { name: "DROGUE", color: COLOR },
        6: { name: "MAIN", color: COLOR },
        7: { name: "TOUCHDOWN", color: COLOR },
    }

    let shapes = []
    let annotations = []


    function events(lastStyle, ts, lastTs) {
        if (lastStyle) {
            shapes.push({
                type: 'rectangle',
                x0: lastTs,
                y0: 0,
                x1: ts,
                y1: 0.05,
                xref: 'x',
                yref: 'paper',
                opacity: 0.8,
                fillcolor: STATE_COLOR,
                line: {
                    color: STATE_COLOR,
                    width: 0,
                }
            },)

            annotations.push({
                xref: 'x',
                yref: 'paper',
                x: (ts + lastTs) / 2,
                xanchor: 'center',
                y: 0.05 / 2,
                font: { color: "white" },
                yanchor: 'middle',
                text: lastStyle.name,
                showarrow: false,
            })
        }
    }

    let i = 0
    let lastStyle = undefined
    let lastTs = 0
    for (let state of flightlog.flightStates) {

        let ts = state.ts
        let style = STATE_MAP[state.state]

        events(lastStyle, ts, lastTs)
        i++;

        lastStyle = style
        lastTs = ts
    }
    events(lastStyle, flightlog.lastTs, lastTs)

    i = 0
    for (let event of flightlog.eventInfo) {

        let ts = event.ts
        let style = EVENT_MAP[event.event]

        shapes.push({
            type: 'line',
            x0: ts,
            y0: 0,
            x1: ts,
            y1: 1,
            xref: 'x',
            yref: 'paper',
            line: {
                color: COLOR,
                width: 2
            }
        })

        let action = ACTION_MAP[event.action]

        annotations.push({
            xref: 'x',
            yref: 'paper',
            x: ts,
            xanchor: 'left',
            y: 1,
            textangle: 0,
            color: "black",
            yanchor: 'top',
            text: style.name,
            font: { color: EVENT_COLOR },
            showarrow: false,
        })
        annotations.push({
            xref: 'x',
            yref: 'paper',
            x: ts,
            xanchor: 'left',
            y: 0.05,
            textangle: 0,
            color: "black",
            yanchor: 'bottom',
            text: (action ? " " + action.name + " " + action.arguments(event.argument) : ""),
            font: { color: ACTION_COLOR },
            showarrow: false,
        })
        i++;
    }

    return { shapes: shapes, annotations: annotations }
}

export function makePlots(flightlog, element) {
    let eventInfo = makeEventInfoTraces(flightlog)

    element.replaceChildren([])

    let el = document.createElement("div")
    document.create
    element.append(el)
    makePlot(flightlog.flightInfo, el, "Altitude [m]", ["height"], eventInfo)

    el = document.createElement("div")
    element.append(el)
    makePlot(flightlog.flightInfo, el, "Velocity [m/s]", ["velocity"], eventInfo)

    el = document.createElement("div")
    element.append(el)
    makePlot(flightlog.flightInfo, el, "Acceleration [m/s^2]", ["acceleration"], eventInfo)

    el = document.createElement("div")
    element.append(el)
    makePlot(flightlog.imu, el, "Acceleration [m/s^2]", ["Ax", "Ay", "Az"], eventInfo)

    el = document.createElement("div")
    element.append(el)
    makePlot(flightlog.imu, el, "Angular Movement [deg/s]", ["Gx", "Gy", "Gz"], eventInfo)

    el = document.createElement("div")
    element.append(el)
    makePlot(flightlog.baro, el, "Pressure [hPa]", ["P"], eventInfo)

    el = document.createElement("div")
    element.append(el)
    makePlot(flightlog.baro, el, "Temperature [°C]", ["T"], eventInfo)

    el = document.createElement("div")
    element.append(el)
    makePlot(flightlog.filteredDataInfo, el, "Altitude [m]", ["filteredAltitudeAGL"], eventInfo)

    el = document.createElement("div")
    element.append(el)
    makePlot(flightlog.voltageInfo, el, "Voltage [V]", ["voltage"], eventInfo)
}
