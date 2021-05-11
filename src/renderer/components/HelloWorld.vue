<template>
    <layout>

        <router-link to="/landing">Landing page</router-link>
        <button v-on:click="serial_list">List</button>
        <select options=portsList></select>
        

        <button v-on:click="serial_connect(1)">Connect</button>
        <button v-on:click="serial_disconnect">Disconnect</button>

        
        
    </layout>
</template>

<script>

import Layout from './Layout.vue';

const SerialPort = require("serialport");
const Readline = require('@serialport/parser-readline')
var open_port = null;
var portsList = [];

var intervalId = setInterval(function() {
    if(open_port == null){
        console.log("Update Serial Ports")
    }
}, 5000);



export default {

    components: {
        Layout
    },

    methods: {
    serial_list: function () {
        portsList = [];
        SerialPort.list().then(ports => {
            ports.forEach((port) => {
            portsList.push(port);
            });
        });

        console.log(portsList);

    },

    serial_connect: function (index) {
        if(portsList.length > index){
            //clearInterval(intervalId);
            open_port = new SerialPort(portsList[index].path, function (err) {
                if (err) {
                    open_port=null;
                    return console.log('Error: ', err.message);
                } 
            })
            //open_port.write("Connected\n");
            //console.log("Port Open");
            }
        var parser = open_port.pipe(new Readline({ delimiter: '\n' }))
        //parser.on('data', console.log)
        return open_port, parser;
    },

    serial_disconnect: function(){
        if(open_port!=null){
            open_port.close();
            open_port=null;
            console.log("Port Closed");
        }
    }
  }
}

</script>


