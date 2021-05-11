const SerialPort = require("serialport");
const Readline = require('@serialport/parser-readline')




const state = {
    open_port: null,
    portsList: []
  }
  
  const mutations = {
    DECREMENT_MAIN_COUNTER (state) {
      state.main--
    },
    INCREMENT_MAIN_COUNTER (state) {
      state.main++
    }
  }
  
  const actions = {
    list() {
        this.$store.state.portsList = [];
            SerialPort.list().then(ports => {
                this.$store.state.ports.forEach((port) => {
                this.$store.state.portsList.push(port);
            });
        });
        return portsList;
    }
  }
  
  export default {
    state,
    mutations,
    actions
  }
  



