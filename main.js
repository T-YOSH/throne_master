/*
 * Author: Dan Yocom <dan.yocom@intel.com>
 * Copyright (c) 2014 Intel Corporation.

 * git checkout -b samp-monitor origin/samp-monitor

 * Permission is hereby granted, free of charge, to any person obtaining
 * a copy of this software and associated documentation files (thelsmod
 * "Software"), to deal in the Software without restriction, including
 * without limitation the rights to use, copy, modify, merge, publish,
 * distribute, sublicense, and/or sell copies of the Software, and to
 * permit persons to whom the Software is furnished to do so, subject to
 * the following conditions:
 * The above copyright notice and this permission notice shall be
 * included in all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
 * EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
 * MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
 * NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
 * LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
 * OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
 * WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

var DEBUG = false;
var GPIO_ON = true;
var DEVELOPMENT = false;

//var SERIAL_RX_PACKET_SIZE = 51; // for basic applli
//var SERIAL_NO_DATA_SIZE = 8;// for basic applli

var SERIAL_RX_PACKET_SIZE_MIN = 63;  //for samp monitor
var SERIAL_RX_PACKET_SIZE_MAX = 70;  //for samp monitor
var SERIAL_NO_DATA_SIZE = 7;

// **** samp monitor **** //
//RXパケットビットマップ
//;1001;00000000;144;005;1007bbd;3330;1719;0016;0000;0001
//	5 子機のID
//	6 子機の電圧
//	10 子機DIのビットマップ
// **** samp monitor end **** //

var BATTERY_WARNING_LEVEL = 0xA28; // 2.6V
var BATTERY_LOGGING_INTERVAL = 6; // hour.

var SENSOR_HOLDING_TIME =1; //min
//var SENSOR_HOLDING_TIME =1; //min
var SENSOR_NUM =2;

var SENSOR_HEALTH_INTERVAL_TIME =60; //sec

//for Syuzai 20160417

//error flag
var error_detecting = false; // automatically reset after 60 sec
var error_num = 0x05;
var error_indicate_start_time = 0;
var ERROR_INDICATE_TIMEOUT = 1*60;//sec
var error_indicater_state = 0;

//DEBUG INDICATE
var DEBUG_INDICATE_ON = false;
var DEBUG_INDICATE_MODE = 0x00; //default indicate the num of the sensor connected

//http
var http = require('http');
var request = require('request');
require('date-utils');
var fs = require('fs');
var m = require('mraa'); //require mraa

//https
var https = require('https');

var express = require('express');
var app = express();
//var conf = require('./config/config.json')[app.get('env')];
var conf = require('./config/config.json')['production'];
if(DEVELOPMENT){
    conf = require('./config/config.json')['development'];
}

var jsonDevices = require(conf.filePathToDevices);
var jsonChild = require(conf.filePathToChild);
var jsonParent = require(conf.filePathToParent);
//var jsonStoreInfo = require(conf.filePathToStoreInfo);

	console.log('MRAA Version: ' + m.getVersion()); //write the mraa version to the console

    //////////////////
    // GPIO SETTING //
    //////////////////

    var myErrorrIndicatePin = new m.Gpio(14); //setup GP13 (J18-1)

    var myDigitalPin = new m.Gpio(15); //setup GP165 (J18-2)
    var myDigitalPin2 = new m.Gpio(20); //setup GP12 (J18-7)01

    var myDigitalPins = [myDigitalPin,myDigitalPin2];

    if(GPIO_ON){
        myErrorrIndicatePin.dir(m.DIR_OUT); //set the gpio direction to input
        //myErrorrIndicatePin.write(1);
        setErrorIndicateGPIO(1);
        blinkErrorIndicaterActivity();

        myDigitalPin.dir(m.DIR_OUT); //set the gpio direction to input
        myDigitalPin.write(0);

        //    var myDigitalPin2 = new m.Gpio(14); // should not  setup GP13 (J18-1)on pin14
        myDigitalPin2.dir(m.DIR_OUT); //set the gpio direction to input
        myDigitalPin2.write(0);
        //    var myDigitalPin3 = new m.Gpio(15); //setup digital read on pin15
        //	myDigitalPin3.dir(m.DIR_OUT); //set the gpio direction to input
        //    myDigitalPin3.write(0);

        //    var myDigitalPins = [myDigitalPin,myDigitalPin2,myDigitalPin3];
    }

    //this is temporal
//    var previousSetTime = new Array( SENSOR_NUM );
//    for(var i = 0; i < SENSOR_NUM ; i++){
//        previousSetTime[i]=0;
//    }
    var holdingTime =SENSOR_HOLDING_TIME;//minute

    //this is for logging of power level
    var previousPowerLoggintTime =0;
    var powerLoggingHoldingTime = BATTERY_LOGGING_INTERVAL*100*100; //hour


    /////////////////////////
    // SERIAL PORT SETTING //
    /////////////////////////
    //var SerialPort = require("serialport").SerialPort;
    var SerialPort = require("serialport");
    var port = "/dev/ttyMFD1"; // ttyMFD2 is for FTED port
    //var serialPort = new SerialPort(port, {  baudrate:115200}, false);
    console.log("********************** Open port: "+ port);
    var serialPort = new SerialPort(port, {  baudrate:115200});

    /////////////////////////
    // SERIAL NUMBER SETTING //
    /////////////////////////
    setSerialNum();

    ///////////////
    // Serial RX //
    ///////////////
    console.log("Open port: "+ port);
    //serialPort.open(function (error) {
    serialPort.on('open',function (error) {
              if (error) {
                    console.log('Failed to open: '+error);
            } else {
                  console.log('open');
                  serialPort.on('data', function(data) {
                        if(data.length>11){
                            debugConsoleLog('RX ' + data);
                        }

                        ///////////////
                        // check the rx data content
                        ///////////////
                        //debugConsoleLog('CHECK data.length = ' + data.length +" (max " + SERIAL_RX_PACKET_SIZE_MAX+")");

                        if( !(data.length > SERIAL_RX_PACKET_SIZE_MIN) || !(data.length <= SERIAL_RX_PACKET_SIZE_MAX)  ){
                            //debugConsoleLog.log('RX data size is ' + data.length);
                            //debugConsoleLog.log('RX data size is incorrect : ignored');
                            return;
                        }

                        strData = data.toString("ascii");
                        parseData = strData.split(";");

                        //var serial_id = data.slice(11,19);
                        //var serial_id = data.slice(22,29);
                        var serial_id = parseData[5];
                        // -> when with the samp mopnitor

                        var serial_id_found = false;
                        var senser_number = 0;

                        ///////////////
                        // search serial_id in sensor list
                        ///////////////

                        var numOfSensors = Object.keys(jsonDevices.children).length;
                        for(var i = 0; i < numOfSensors ; i++){
                            var sensorValues = jsonDevices.children[i];
                            //debugConsoleLog("JUDGE child "+ i+ " "+ String (sensorValues.serial_id) +"==" +String(serial_id))
                            if( (String (sensorValues.serial_id) == String(serial_id))
                                && ( serial_id.length == SERIAL_NO_DATA_SIZE )
                              ){
                                serial_id_found=true;
                                senser_number=i;
                            }
                        }

                        if(serial_id_found){
                            debugConsoleLog('found the sensor(' + serial_id + ') in the children as senser_number = ' + (senser_number+1) );
                            /////////////////////////////////////////////////
                            // update the sensor node                      //
                            /////////////////////////////////////////////////

                            var sensorValues = jsonDevices.children[senser_number];

                            //　センサーのデジタル信号は負論理
                            //var intDigitalValue = (data.slice(33,35)&0x01)==1 ? 0 : 1 ;
                            var intDigitalValue = ( parseData[12]&0x01)==1 ? 0 : 1 ;
                            // -> when with the samp mopnitor

                            var digitalInValue = (intDigitalValue==1)? '1': '0';

                            //debugConsoleLog('sensor current digital_in = ' + sensorValues.digital_in);
//                               debugConsoleLog('data.slice(33,35) = ' + data.slice(33,35));
                            //debugConsoleLog('digitalInValue = ' + digitalInValue);
//                                debugConsoleLog('intDigitalValue = ' + intDigitalValue);

                            //check the current digital_in value
                            if(sensorValues!=undefined){
//                                if ( sensorValues.digital_in !=  digitalInValue ){
                                    //temporal
//                                    if((String(sensorValues.serial_id)==CONT_VAL_ID_1)
//                                       ||(String(sensorValues.serial_id)==CONT_VAL_ID_2)){

                                if(true){
                                        var openDt = new Date();
                                        var formatted = openDt.toFormat("YYYYMMDDHH24MISS");

//                                        debugConsoleLog('================== DEBUG SENSOR NUM ' + senser_number);
//                                        debugConsoleLog(+formatted + " > " + (+previousSetTime[senser_number]+holdingTime*100) );


                                    //if( (+formatted > ( parseInt(sensorValues.previous_settime, 10)+holdingTime*100)) && (digitalInValue == 1) ){
                                    if( digitalInValue == 1 ){

                                        if (+formatted > ( parseInt(sensorValues.previous_settime, 10)+holdingTime*100)){
                                            //////////////////////
                                            // update DB        //
                                            //////////////////////

                                            console.log('================== FRAG UP SENSOR' + senser_number);

                                            debugConsoleLog( serial_id + ': XXX digital_in = changed to' + digitalInValue);
                                            sensorValues['digital_in'] = digitalInValue;

                                            //change GPIO state

                                            if(GPIO_ON){
    //                                                debugConsoleLog('check [ ' + senser_number+ '].write(' + intDigitalValue+')');
                                                if(myDigitalPins.length>senser_number){
                                                    debugConsoleLog('write myDigitalPins: myDigitalPins[ ' + senser_number+ '].write(' + intDigitalValue+')');
                                                    myDigitalPins[senser_number].write(intDigitalValue);
                                                }
                                            }
                                            //send state change to the server
                                            //pushDataToServer(jsonStoreInfo.parent_id,intDigitalValue,(senser_number+1));
                                            pushDataToServer(jsonDevices.parent_id,intDigitalValue,jsonDevices.children[senser_number].serial_id) ;

                                            sensorValues['previous_settime'] =formatted;
                                            //previousSetTime[senser_number]=formatted;
                                            //periodicActivity();
                                        } else{
                                            console.log('================== UPDATE SETTIME sensor ' + senser_number);

                                            sensorValues['previous_settime'] =formatted;
                                            //previousSetTime[senser_number]=formatted;
                                            //periodicActivity();
                                        }

                                        }else{
                                            //debugConsoleLog('NO CHANGED');
                                        }
                                    }else{
                                    //////////////////////
                                    // update DB        //
                                    //////////////////////

                                    debugConsoleLog( serial_id + ': X2 digital_in = changed to' + digitalInValue);
                                    sensorValues['digital_in'] = digitalInValue;

                                    ///////////////////////
                                    // change GPIO state //
                                    ///////////////////////

                                    if(GPIO_ON){
                                        debugConsoleLog('set myDigitalPins: senser_number = ' + senser_number+ ' intDigitalValue = ' + intDigitalValue);
                                        myDigitalPins[senser_number].write(intDigitalValue);
                                    }
                                    //send state change to the server
                                    pushDataToServer(jsonDevices.parent_id,intDigitalValue,(senser_number+1)) ;
                                    }
//                                }else{
//                                    console.log('digitalInValue is not changed , now ' + digitalInValue);
//                                }

                                //check the current battery_voltage
                                if ( sensorValues.battery_voltage != parseData[6]){
                                    // when with samp monitor

                                    debugConsoleLog( 'battery_voltage = changed to' + parseData[6] );
                                    sensorValues['battery_voltage'] = parseData[6]
                                }

                                // if voltage is under *** V, send caution message to the server
                                var intBatteryValue = parseData[6] ;

                                if((intBatteryValue <  BATTERY_WARNING_LEVEL)){
                                        setErrorIndicate(0x34,"");
                                        console.log('WARNING , battery level is low ' + intBatteryValue );
                                }else{
                                    debugConsoleLog('BATTERY DEBUG , battery level is OK : ' + intBatteryValue+ ' V ');
                                }

                            }else{
                                    console.log( 'sensor not found ');
                            }
                        }else{
                            /////////////////////////////////////////////////
                            // add the serial_number into the sensor list  //
                            /////////////////////////////////////////////////
                            console.log('add sensor(' + serial_id + ') into the children');
//                            jsonDevices.children.push(serial_id.toString('ascii'));
//                            jsonDevices.sensor_value.push(data.slice(33,35).toString('ascii'));

                            /////////////////////////////////////////////////
                            // create the sensor node into the sensnrs.json  //
                            /////////////////////////////////////////////////

                            var data = {
//                                id: data.slice(1,3).toString('ascii'),
//                                com: data.slice(3,5).toString('ascii'),
//                                packet_id: data.slice(5,7).toString('ascii'),
//                                serial_id: data.slice(11,19).toString('ascii'),
//                                battery_voltage: data.slice(27,31).toString('ascii'),
//                                digital_in: data.slice(33,35).toString('ascii'),
//                                digital_in_change: data.slice(35,37).toString('ascii'),
                                timestamp: parseData[1],
                                lqi: parseData[3],
                                counter: parseData[4],
                                serial_id: parseData[5],
                                battery_voltage: parseData[6],
                                digital_in: parseData[12],
                                previous_settime: "0",
                            };

//                            jsonChild["timestamp"] = parseData[1];
//                            jsonChild["lqi"] = parseData[3];
//                            jsonChild["counter"] = parseData[4];
//                            jsonChild["serial_id"] = parseData[5];
//                            jsonChild["battery_voltage"] = parseData[6];
//                            jsonChild["digital_in"] = parseData[12];

                            console.log('############# data.serial_id (' +data.serial_id + ' data.serial_id.length=' + data.serial_id.length)

                            if(data.serial_id.length==SERIAL_NO_DATA_SIZE){
//                                jsonDevices.children.push(jsonChild);
                                jsonDevices.children.push(data);
//                                jsonDevices["sensor_"+ (numOfSensors+1) ] = data;
                                storeJson();
                                console.log('create ' + "sensor_"+ (numOfSensors+1) );
                            }

                        }
                    });
              }
    });

	var openDt = new Date();
	//var logFileName = '/home/root/.node_app_slot/log/jinkanLog_'+openDt.toFormat("YYYYMMDD_HH24_MI_SS");
	var logFileName = '/home/root/.node_app_slot/log/BatteryLog';
	var errorLogFileName = '/home/root/.node_app_slot/log/ErrorLog';
  	fs.writeFile(logFileName, "--------- log ---------\n",function(err) {console.log(err)}  );

    var openDt = new Date();
    curTime = openDt.toFormat("YYYYMMDDHH24MISS");
    startMessage = "<"+curTime+"> APPLICATION START ";
    storeErrorLog(startMessage);

var pushDataToServer = function pushDataToServer (store_id, status, seat_id) {

    if( (status!=1)&&(status!=0)){
  		console.log('Send data to server, failed status (' +status + ') is not defined ' ); //write the read value out to the console
        return;
    }

  	var dt = new Date();

    //debugConsoleLog("NETWORK DATA " + "Send data to server, parent_id=" + store_id+ ' child_id =' + seat_id+ ' value=' + status);

    ///////////////////
    // POST method   //
    ///////////////////

//    var options = {
//        uri: conf.url,
//        form: { 'store_id': store_id,'status': status ,'seat_id': seat_id },
//        json: true
//    };
//    request.post(options, function(error, response, body){
//        if (!error && response.statusCode == 200) {
//            console.log(body);
//            console.log('Send data to server, seat_id=' + seat_id+ ' value=' + status); //write the read value out to the console
////            console.log('     Time is ' + dt.toFormat("YYYY MM DD HH24 MI:SS")); //the read value out to the console
//        } else {
//            console.log('error: ');
//        }
//    });

    if(DEVELOPMENT){
    }else{
        ///////////////////
        // GET method (Https)  //
        ///////////////////
        //https://www.vacanservice.com/api/v1/throne/seat/update
/*
        //url = conf.url + '?store_id=' + store_id+ '&seat_id=' + seat_id + '&status=' + status + '&token=' + 1;

        url = conf.url + '?parent_id=' + store_id+ '&child_id=' + seat_id + '&status=' + status + '&token=' + 1;

        https.get(url, function(res) {
          console.log("statusCode: ", res.statusCode);
          console.log("headers: ", res.headers);

          res.on('data', function(d) {
            process.stdout.write(d);
          });

        }).on('error', function(e) {
            console.error(e);
            setErrorIndicate(0x00);
        });
*/
        ///////////////////
        // POST method   //
        ///////////////////
        // https://api.throneservice.com/vacancy -X POST -d '{"parentId": 1, "childId":"1", "status":"in_use"}' -H 'Content-Type:application/json

        statusName="in_use"

        if(status ==0){
            statusName="vacancy"
        }


        console.log("<<<<<<<<< NETWORK DATA " + "Send data to server "+conf.url+" parentId=" + store_id+ ' childId =' + seat_id+ ' status=' + statusName);

        var options = {
            uri: conf.url,
            headers: {  'Content-Type': 'application/json' },
            body: JSON.stringify({"parentId":store_id, "childId":seat_id, "status":statusName})
        };

        request.post(options, function(error, response, body){
            if (!error && response.statusCode == 200) {
                //console.log('>>>>>>>>> RESPONSE DATA STATUS : 200');
                debugConsoleLog('<body>');
                debugConsoleLog(body);
                debugConsoleLog('</body>');
                debugConsoleLog('Send data to server, childId=' + seat_id+ ' status=' + statusName); //write the read value out to the console
//                console.log('     Time is ' + dt.toFormat("YYYY MM DD HH24 MI:SS")); //the read value out to the console
                if(JSON.parse(body).ok){
                    console.log('>>>>>>>>> RECEIVED DATA TRUE');
                }else{
                    console.log('>>>>>>>>> RECEIVED DATA FALSE');
                    if(JSON.parse(body).errors){
                        debugConsoleLog('>>>>>>>>> FALSE MESSAGE ' + JSON.parse(body).errors[0].message);
                        debugConsoleLog('>>>>>>>>> FALSE PARAM   ' + JSON.parse(body).errors[0].param);
                        debugConsoleLog('>>>>>>>>> FALSE CODE    ' + JSON.parse(body).errors[0].code);
                        setErrorIndicate(0x02, "sensor " + seat_id +" "+JSON.parse(body).errors[0].message +" "+JSON.parse(body).errors[0].param +" "+JSON.parse(body).errors[0].code );
                    }
                }
            } else {
                if(error){
                    console.log('>>>>>>>>> RESPONSE DATA STATUS RESPONSE ERROR : '+response);
                    setErrorIndicate(0x02, "sensor " + seat_id +" "+response);
                }else{
                    console.log('>>>>>>>>> RESPONSE DATA STATUS TIMEOUT : '+response);
                    setErrorIndicate(0x04, "sensor " + seat_id +" "+response);
                }
            }
        });
        debugConsoleLog('>>>>>>>>> END OF NETWOTK DATA');

    }
}

var pushHealthToServer = function pushDataToServer (store_id, seat_id, power, status ) {

    if( (status!="available")&&(status!="unavalable")&&(status!="updating")){
  		console.log('Send data to server, failed status (' +status + ') is not defined ' ); //write the read value out to the console
        return;
    }

  	var dt = new Date();

    //debugConsoleLog("NETWORK　HEALTH " + "Send health to server, parent_id=" + store_id+ ' child_id =' + seat_id+ ' status=' + status +  ' battery=' + power);

    if(DEVELOPMENT){
    }else{

        console.log("<<<<<<<<< NETWORK　HEALTH " + "Send health to server "+conf.health_url+" parentId=" + store_id+ ' childId =' + seat_id+ ' status=' + status+  ' battery=' + power);

        var options = {
            uri: conf.health_url,
            headers: {  'Content-Type': 'application/json' },
            body: JSON.stringify({"parentId":store_id,　"childId":seat_id,　"status": status ,　"power": power  })
        };

        request.post(options, function(error, response, body){
            if (!error && response.statusCode == 200) {
                console.log('>>>>>>>>> RESPONSE HEALTH STATUS : 200');
                debugConsoleLog('<body>');
                debugConsoleLog(body);
                debugConsoleLog('</body>');
                debugConsoleLog('Send data to server, childId=' + seat_id+ ' status=' + status+ ' power=' + power); //write the read value out to the console
                if(JSON.parse(body).ok){
                    console.log('>>>>>>>>> RECEIVED HEALTH TRUE');
                }else{
                    console.log('>>>>>>>>> RECEIVED HEALTH FALSE');
                    if(JSON.parse(body).errors){
                        debugConsoleLog('>>>>>>>>> FALSE MESSAGE ' + JSON.parse(body).errors[0].message);
                        debugConsoleLog('>>>>>>>>> FALSE PARAM   ' + JSON.parse(body).errors[0].param);
                        debugConsoleLog('>>>>>>>>> FALSE CODE    ' + JSON.parse(body).errors[0].code);
                        setErrorIndicate(0x12, "sensor " + seat_id +" "+JSON.parse(body).errors[0].message +" "+JSON.parse(body).errors[0].param +" "+JSON.parse(body).errors[0].code );
                    }
                }
            } else {
                if(error){
                    console.log('>>>>>>>>> RESPONSE HEALTH STATUS RESPONSE ERROR : '+response);
                    setErrorIndicate(0x12, "sensor " + seat_id +" "+response);
                }else{
                    console.log('>>>>>>>>> RESPONSE HEALTH TIMEOUT : '+response);
                    setErrorIndicate(0x14, "sensor " + seat_id +" "+response);
                }
            }
        });
        debugConsoleLog('>>>>>>>>> END OF NETWOTK HEALTH');
    }
}

function storeJson () {
    debugConsoleLog("DB",'save Json DB ');
    fs.writeFileSync(conf.filePathToDevices,JSON.stringify(jsonDevices,null," "))
    fs.writeFileSync(conf.filePathToChild,JSON.stringify(jsonParent,null," "))
    fs.writeFileSync(conf.filePathToChild,JSON.stringify(jsonChild,null," "))
}

function storeLog (message) {
    //debugConsoleLog('================== storeLog ');
 	fs.appendFile(logFileName, message+"\n",function(err) {console.log(err)}  );
}

function storeErrorLog (message) {
    //debugConsoleLog('================== storeErrorLog ');
 	fs.appendFile(errorLogFileName, message+"\n",function(err) {console.log(err)}  );
}

function debugConsoleLogWithName(name,message){
    if(DEBUG){
        cosoleMessage = '---- ' + name + ' ---- : ' + message;
        console.log(cosoleMessage);
    }
}

function debugConsoleLog(message){
    if(DEBUG){
        cosoleMessage = "---- "+ "DEBUG" + " ---- : " + message;
        console.log(cosoleMessage);
    }
}

function setErrorIndicate(errNum,errStr){

    var openDt = new Date();
    error_indicate_start_time = openDt.toFormat("YYYYMMDDHH24MISS");

    //logging error message
    loggingMessage = "<"+error_indicate_start_time+"> ";
    loggingMessage+= errNum;
    loggingMessage+= ',';

    getIP()
    if(ipAddress==""){
        debugConsoleLog("NO IP ADDRESS " + ipAddress)
        loggingMessage+= 'no IP,'+ ipAddress;
    }else if( (error_num&0x02)){
        loggingMessage+= 'response,';
    }else if(error_num&0x04){
        loggingMessage+= 'timeout,';
    }else if(error_num&0x08){
        loggingMessage+= 'other,';
    }else{
        loggingMessage+= 'others,';
    }

    if(error_detecting==false){
        error_detecting=true;
        error_num=errNum;
        debugConsoleLog("---- INDICATOR ---- SET ERROR INDICATE WITH message =" + loggingMessage );
        blinkErrorIndicaterActivity();
        loggingMessage+= 'start,';
    }else{
        loggingMessage+= 'continue,';
    }

    loggingMessage += "[" +errStr+"]";
    storeErrorLog(loggingMessage);
}

function setSerialNum(){
    // get serial Num from /factory/serial_number
	var serialNumFileName = '/factory/serial_number';
    fs.readFile(serialNumFileName, 'utf8', function (err, text) {
        // set the serial number into store_id in sensors.json
        console.log('The device serial number is '+ text);
        jsonDevices["parent_id"] = text.slice(0,16);
        //jsonDevices["parent_id"] = "FZED445D01WYT501";  //for test
    });

}

//pushDataToServer(23949,0,1);
//pushDataToServer(23949,0,2);
periodicActivity(); //call the periodicActivity function
periodicHealthSenderActivity();
var loggingBatteryCnt = 10;

function periodicActivity() {

    debugConsoleLogWithName('PERIODIC','START');

    var openDt = new Date();
    var formatted = openDt.toFormat("YYYYMMDDHH24MISS");

    // get the sensorNum of serial CONT_VAL_ID
    var numOfSensors = Object.keys(jsonDevices.children).length;
    var sensorNum=0;
    for(var i = 0; i < numOfSensors ; i++){
//
        sensorNum=i;

        var sensorValues = jsonDevices.children[sensorNum];

         ///////////////
        // Sensor On timer
        ///////////////

//        debugConsoleLog('================== periodic : sensor ' + sensorNum + ' ' + formatted + ' > ' + (previousSetTime[sensorNum]+holdingTime*100) ) ;
        debugConsoleLog('================== periodic : sensor ' + sensorNum + ' current ' + formatted + ' : timeout ' + (parseInt(sensorValues.previous_settime, 10)+holdingTime*100) ) ;



        if( (+formatted > ( parseInt(sensorValues.previous_settime, 10)+holdingTime*100)) && (sensorValues.digital_in == 1 ) ){
//        if( (+formatted > (+previousSetTime[sensorNum]+holdingTime*100)) && (sensorValues.digital_in == 1 ) ){
            console.log('================== FRAG DOWN ' + sensorNum );

            sensorValues.digital_in = 0;
            if(GPIO_ON){
                if(myDigitalPins.length>sensorNum ){
                    myDigitalPins[sensorNum].write(0);
                }
            }
            //send state change to the server
            //pushDataToServer(jsonStoreInfo.parent_id,0,sensorNum+1) ;
            pushDataToServer(jsonDevices.parent_id,0,jsonDevices.children[sensorNum].serial_id) ;

            //previousSetTime[sensorNum]=0;
            sensorValues.previous_settime="0";
        }
    }

    ///////////////
    // Battery Log
    ///////////////
    if((+formatted > (+previousPowerLoggintTime+powerLoggingHoldingTime))){
        var message = "<Battery"+formatted+">";
        var numOfSensors = Object.keys(jsonDevices.children).length;
        for(var i = 0; i < numOfSensors ; i++){
            var sensorValues=jsonDevices.children[i];
            message+= sensorValues.serial_id;
            message+= ',';
            message+= sensorValues.battery_voltage
            message+= ':';
        }
        debugConsoleLog( message );
        storeLog(message);
        previousPowerLoggintTime = formatted;
    }
    setTimeout (periodicActivity,2000); //call the indicated function after 1 second (1000 milliseconds)
}


"use strict";

var gulp = require( 'gulp' );

var os = require('os');
var ifaces = os.networkInterfaces();
var ipAddress;

getIP()

function periodicHealthSenderActivity() {

    debugConsoleLogWithName('HEALTH SENDOR','START');
    //debugConsoleLogWithName('HEALTH SENDOR','IP   ' + getIP;

    var openDt = new Date();
    var formatted = openDt.toFormat("YYYYMMDDHH24MISS");

    // get the sensorNum of serial CONT_VAL_ID
    var numOfSensors = Object.keys(jsonDevices.children).length;
    var sensorNum=0;
//    for(var i = 0; i < numOfSensors ; i++){
////
//        sensorNum=i;
//
//        var sensorValues = jsonDevices.children[sensorNum];
//
//         ///////////////
//        // Sensor On timer
//        ///////////////
//
//        jsonDevices.children[sensorNum].status="available" //temporal
//
//        debugConsoleLog('================== periodic : sensor' + sensorNum + "health info") ;
//        debugConsoleLog('==================   health : pareint            ' + jsonDevices.parent_id ) ;
//        debugConsoleLog('==================   health : serial_id            ' + jsonDevices.children[sensorNum].serial_id ) ;
//        debugConsoleLog('==================   health : battery_voltage    ' + jsonDevices.children[sensorNum].battery_voltage ) ;
//        debugConsoleLog('==================   health : status             ' + jsonDevices.children[sensorNum].status ) ;
//
//        pushHealthToServer(jsonDevices.parent_id,
//                           jsonDevices.children[sensorNum].serial_id,
//                           jsonDevices.children[sensorNum].battery_voltage,
//                           jsonDevices.children[sensorNum].status)
//    }

    // パラメータ
    counter = 0;
    // 実処理の実行
    loop();

    function loop() {
        // 目的のカウント数実行したら終了
        if(counter==numOfSensors) return;

        //TODO: 何かの処理
        sensorNum=counter;

        var sensorValues = jsonDevices.children[sensorNum];

         ///////////////
        // Sensor On timer
        ///////////////

        jsonDevices.children[sensorNum].status="available" //temporal

        debugConsoleLog('================== periodic : sensor' + sensorNum + "health info") ;
        debugConsoleLog('==================   health : pareint            ' + jsonDevices.parent_id ) ;
        debugConsoleLog('==================   health : serial_id            ' + jsonDevices.children[sensorNum].serial_id ) ;
        debugConsoleLog('==================   health : battery_voltage    ' + jsonDevices.children[sensorNum].battery_voltage ) ;
        debugConsoleLog('==================   health : status             ' + jsonDevices.children[sensorNum].status ) ;

        if(jsonDevices.children[sensorNum].serial_id.length==SERIAL_NO_DATA_SIZE){
            pushHealthToServer(jsonDevices.parent_id,
                           jsonDevices.children[sensorNum].serial_id,
                           jsonDevices.children[sensorNum].battery_voltage,
                           jsonDevices.children[sensorNum].status)
        }
        counter++;
        // 次の回の実行予約
        setTimeout(function(){
            loop();
        }, 1000);

    }


    setTimeout (periodicHealthSenderActivity,SENSOR_HEALTH_INTERVAL_TIME*1000); //call the indicated function after 1 second (1000 milliseconds)
    //setTimeout (periodicHealthSenderActivity,600000); //call the indicated function after 1 second (1000 milliseconds)
}

function setErrorIndicateGPIO(state){
    //debugConsoleLog("---- INDICATOR ---- setErrorIndicateGPIO = " + state);
    myErrorrIndicatePin.write(state);
    error_indicater_state=state;
}

function blinkErrorIndicaterActivity() {

    ///////////////
    // Error Detect indicate
    ///////////////

    // ERROR NUM
    // network_error = 0x00;
    // battery_error = 0x01;
    // child_error = 0x02;

    var blink_wait_time_msec = 500;

    if(error_detecting==true){
        //console.log("ERROR DITECT");
        //debugConsoleLog("INDICATOR" , "ERROR_NUM " + error_num);

        var openDt = new Date();
        var formatted = openDt.toFormat("YYYYMMDDHH24MISS");

        if((+formatted > (+error_indicate_start_time+ERROR_INDICATE_TIMEOUT))){
            error_detecting=false;
            debugConsoleLog("INDICATOR" + "ERROR_INDICATE_TIMEOUT ");
            if(error_indicater_state==0){
                //myErrorrIndicatePin.write(1);
                debugConsoleLog("INDICATOR" , "ERROR_INDICATE END :STATE CHANGE TO false");
                setErrorIndicateGPIO(1);
            }
            return;
        }

        if(error_num&&0x01==0x01){
            blink_wait_time_msec = 200;
        }else if( (error_num&&0x02) ==0x02){
            blink_wait_time_msec = 500;
        }else if(error_num&&0x04==0x04){
            blink_wait_time_msec = 2000;
        }else{
            blink_wait_time_msec = 5000;
        }

//        if(myErrorrIndicatePin.read()==0){
        if(error_indicater_state==0){
            //myErrorrIndicatePin.write(1);
            setErrorIndicateGPIO(1);
        }else{
            //myErrorrIndicatePin.write(0);
            setErrorIndicateGPIO(0);
        }
        setTimeout (blinkErrorIndicaterActivity,blink_wait_time_msec); //call the indicated function after 1 second (1000 milliseconds)
    }else{
//        if(myErrorrIndicatePin.read()==0){
        if(error_indicater_state==0){
            //myErrorrIndicatePin.write(1);
            debugConsoleLog("INDICATOR" , "ERROR_INDICATE END :STATE CHANGE TO false");
            setErrorIndicateGPIO(1);
        }
    }
    //setTimeout (blinkErrorIndicaterActivity,blink_wait_time_msec); //call the indicated function after 1 second (1000 milliseconds)
}

function getIP() {
    ipAddress = "";
    Object.keys(ifaces).forEach(function (ifname) {
      ifaces[ifname].forEach(function (iface) {

        if ('IPv4' !== iface.family || iface.internal !== false) {
          // skip over internal (i.e. 127.0.0.1) and non-ipv4 addresses
          return;
        }
        //console.log(ifname, iface.address);
        // en0 192.168.1.NNN
        ipAddress = iface.address;
      });
    });
}
