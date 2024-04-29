# OSCWebMixer2
A rewrite of [OSCWebMixer](https://github.com/castles/OSCWebMixer) - A server that allows multiple web clients to control their own mix as well as external devices for a DiGiCo sound desk. It currently works with SD Series consoles.

# What makes v2 better?
* This new version uses the same iPad connection that is built into the SD consoles so it means you can use webmixer devices as well as the DiGiCo iPad apps at the same time. In-fact you can use multiple iPad apps simultaneously!
* All configuration is done in a browser instead of config files
* Auxilaries and Channels can have icons assigned to them
* Channels can be sorted
* Custom functionality can be added by writing some simple Plugins. There are a couple of examples of how this can be used in the plugins directory.
* Webmixer can send and receive OSC messages to custom devices. This means it can communicate with TouchOSC, Reaper etc.

## Donate
This project has taken considerable time to create. If you find it useful and would like further development please make a donation.

[![paypal](https://www.paypalobjects.com/en_US/i/btn/btn_donateCC_LG.gif)](https://www.paypal.com/cgi-bin/webscr?cmd=_s-xclick&hosted_button_id=VL5VBHN57FVS2&item_name=OSCWebMixer)

### Requirements
* A SD Series DiGiCo Mixing desk.
* A computer to run the server. Windows, macOS or Linux.
* [Node](https://nodejs.org/en/download/) must be installed. On macOS you can install it with [Homebrew](https://brew.sh/) (brew install node)
* Server, Desk and other devices must all be on the same network

## Basic Setup Instructions
1. Download repository and navigate to the directory in a shell.
2. Run "npm install" to install all the required modules.
3. Run "node ." to start the server.
4. Visit the admin URL in your browser to configure the server.
5. Open the server IP address on another device and start mixing.

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
