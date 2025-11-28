# OSCWebMixer2

A rewrite of [OSCWebMixer](https://github.com/castles/OSCWebMixer) - A server that allows multiple web clients to control their own mix as well as external devices for a DiGiCo sound desk. It currently works with SD Series and Quantum consoles.

## What makes v2 better?

* This new version uses the same iPad connection that is built into the SD/Quantum consoles so it means you can use webmixer devices as well as the DiGiCo iPad apps at the same time. In-fact you can use multiple iPad apps simultaneously!
* All configuration is done in a browser instead of config files
* Auxilaries and Channels can have icons assigned to them
* Channels can be sorted
* Custom functionality can be added by writing some simple Plugins. There are a couple of examples of how this can be used in the plugins directory
* Webmixer can send and receive OSC messages to custom devices. This means it can communicate with TouchOSC, Reaper etc.
* Startup is much quicker because webmixer requests only the information it requires
* You can group your channels to make them easier to find
* The current snapshot name is displayed in webmixer

## Donate

This project has taken considerable time to create. If you find it useful and would like further development please make a donation.

[![paypal](https://www.paypalobjects.com/en_US/i/btn/btn_donateCC_LG.gif)](https://www.paypal.com/cgi-bin/webscr?cmd=_s-xclick&hosted_button_id=VL5VBHN57FVS2&item_name=OSCWebMixer)

## Screenshots

<img src="https://github.com/castles/OSCWebMixer2/assets/323970/952cb304-b4f7-41b1-8308-2481bbbf6d78" width="400">
<img src="https://github.com/castles/OSCWebMixer2/assets/323970/1e43dc8b-3995-4149-8771-3c512d14a378" width="400">
<img src="https://github.com/castles/OSCWebMixer2/assets/323970/c60c263e-c848-4775-8e9a-59052eea2d01" width="400">
<img src="https://github.com/castles/OSCWebMixer2/assets/323970/13b8e955-9633-490f-a321-5783e301758d" width="400">
<img src="https://github.com/castles/OSCWebMixer2/assets/323970/06f017dd-d90e-4d81-83f3-1d85e836ecae" width="400">
<img src="https://github.com/castles/OSCWebMixer2/assets/323970/06f017dd-d90e-4d81-83f3-1d85e836ecae" width="400">
<img src="https://github.com/castles/OSCWebMixer2/assets/323970/51eebca5-4352-4d43-8834-e6ebd74d98e9" width="400">
<img src="https://github.com/castles/OSCWebMixer2/assets/323970/b0deedf0-d0b1-4919-b960-50e2e6259b06" width="400">

## Requirements

* A DiGiCo SD Series or Quantum Mixing desk.
* A computer to run the server. Windows, macOS or Linux.
* [GIT](https://git-scm.com/downloads/win) will need to be installed for Windows. [Node](https://nodejs.org/en/download/) must be installed. On macOS you can install node with [Homebrew](https://brew.sh/) (`brew install node`)
* Server, Desk and other devices must all be on the same network

## Basic Setup Instructions

1. Download repository and navigate to the directory in a shell.
2. Run `npm install` to install all the required modules.
3. Run `npm run start` to start the server.
4. Visit the admin URL in your browser to configure server and mixing desk. See below screenshot for mixing desk configuration.
5. Open the server IP address on another device and start mixing.

<img width="538" height="529" alt="webmixer-external-control" src="https://github.com/user-attachments/assets/c8c01ec9-e153-4555-a19f-ef87dcff3ee5" />

## Basic Setup Instructions For Docker

1. Install Git and Docker

2. Then execute following commands:

```bash
git clone https://github.com/castles/OSCWebMixer2.git

cd OSCWebMixer2 

docker build -t oscwebmixer2:latest .

docker compose up -d
```

1. To see logs and to see what address to connect run:

```bash
docker compose logs -f webmixer
```

## FAQs

<details>
  <summary>My External Devices won't connect</summary>
  Ensure the server is running and the devices are connected on the same network. Verify desk settings in the admin area are correct.
</details>
<details>
  <summary>What devices work?</summary>
  Anything with a recent web browser can connect, that means it should work on iOS, Android, Windows, macOS and Linux.
</details>
<details>
  <summary>How many devices can I connect at once?</summary>
  No limit has been set and we haved tested 20+ without any issues.
</details>
<details>
  <summary>Can I connect multiple iPads at once with the DiGiCo app?</summary>
  Yes, go for it.
</details>
<details>
  <summary>How do I enable a plugin?</summary>
  Add a script into the plugin directory and make sure the filename doesn't start with an underscore. Restart webmixer and your plugin will be loaded.
</details>
<details>
  <summary>Does OSCWebMixer2 also support DiGiCo S-Series consoles?</summary>
  Currently, S-Series consoles are not supported by V2. For now, you will need to use <a href="https://github.com/castles/OSCWebMixer">version 1 of OSCWebMixer</a> with S-Series consoles.<br/>See <a href="https://github.com/castles/OSCWebMixer2/issues/4">this issue</a> for more information.
</details>
