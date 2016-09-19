#!/bin/sh
#install lib
#npm install mraa;
# npm install require;
npm install request; //
npm install date-utils; //
npm install express;//
npm install serialport; //
npm install gulp;
#setup boot up setting
cp service/sensordetect.service /lib/systemd/system/sensordetect.service;
cp service/throne_refresh.service /etc/systemd/system/throne_refresh.service;
cp service/throne_refresh.timer /etc/systemd/system/throne_refresh.timer;
#setup systemd setup
#setup systemd setup
systemctl enable throne_refresh.timer;
#systemctl enable sensordetect.service shutdown;
#setup time setup
timedatectl set-timezone Asia/Tokyo;
