import Vue from 'vue'
import Vuex from 'vuex'

const SerialPort = require("serialport");
const Readline = require('@serialport/parser-readline')

import { createPersistedState, createSharedMutations } from 'vuex-electron'

import modules from './modules'

Vue.use(Vuex)

const Serial = {
  state: {
    open_port: null,
    portsList: []
  },

    
  actions: {
    auto_connect(ports) {
      for(i = 0; i < ports.length; i++){
          if(ports[i].manufacturer == manufacturer_name){
              parser = serial.connect(i);
              if (parser != null){
                  connected = true;
                  return;
              }
          }
      }
    },

    // Button pressed connect
    manual_connect(index) {
      parser = serial.connect(index);
      if (parser != null){
          connected = true;
      }
    },


    getSerialList({state}) {
        state.portsList = [];
            SerialPort.list().then(ports => {
              ports.forEach((port) => {
                state.portsList.push(port);
              });
              
            return state.portsList;
          });

    }
  }
}


export default new Vuex.Store({
  modules: {
    'Serial': Serial
  },
  plugins: [
    createPersistedState(),
    createSharedMutations()
  ],
  strict: process.env.NODE_ENV !== 'production'
})
