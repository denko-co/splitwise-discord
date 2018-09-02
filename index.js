const Discord = require('discord.js');
const bot = new Discord.Client({autoReconnect: true});
const testChannel = '485812106323558410';

bot.login(process.env.TOKEN);

bot.on('ready', function (event) {
  console.log('Logged in as %s - %s\n', bot.user.username, bot.user.id);
});

bot.on('message', function (message) {
  let channelId = message.channel.id;
  if (!message.author.bot && channelId === testChannel) {
    message.channel.send('Ready to rock!');
  }
});
