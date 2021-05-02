const serial = require('serial.js');

var connected = false;
var port_list = [];

var manufacturer_name = "ELTIMA Software";

// Periodically check if new ports are available
var intervalId = setInterval(function() {
    if(connected == false){
        available_ports = serial.list();
        port_list = available_ports.path;
        auto_connect(available_ports);
    }
}, 5000);

// Automatically connect to a device with the correct manufacturer
function auto_connect(ports){
    for(i = 0; i < ports.length; i++){
        if(ports[i].manufacturer == manufacturer_name){
            parser = serial.connect(i);
            if (parser != null){
                connected = true;
                return;
            }
        }
    }
}

// Button pressed connect
function manual_connect(index){
    parser = serial.connect(index);
    if (parser != null){
        connected = true;
    }
}

parser.on('data', function (data) {
    console.log('Data:', data);
})






