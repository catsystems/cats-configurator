const SerialPort = require("serialport");
const Readline = require('@serialport/parser-readline')


var open_port = null;
var portsList = [];

function list() {
    portsList = [];
    SerialPort.list().then(ports => {
        ports.forEach((port) => {
        portsList.push(port);
        });
    });
    return portsList;
}

function connect(index) {
    if(portsList.length > index){
        //clearInterval(intervalId);
        open_port = new SerialPort(portsList[index].path, function (err) {
            if (err) {
                open_port=null;
                return null;
            } 
        })
        console.log("Port Opened");
    }
    var parser = open_port.pipe(new Readline({ delimiter: '\n' }))
    //parser.on('data', console.log)
    return parser;
}

function disconnect(){
    if(open_port!=null){
        open_port.close();
        open_port=null;
        console.log("Port Closed");
    }
}
