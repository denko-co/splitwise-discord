const Discord = require('discord.js');
const bot = new Discord.Client({autoReconnect: true});
const Loki = require('lokijs');
const Splitwise = require('splitwise');
const credentials = require('./credentials.json');
const sw = Splitwise({
  consumerKey: process.env.KEY || credentials.consumerKey,
  consumerSecret: process.env.SECRET || credentials.consumerSecret,
  logger: console.log
});

let initalised = false;
let db;

init(function (err) {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log('Ready to rock!');
});

function getHowToText () {
  let msg = 'Before we get started, you\'re going to have to add me to your splitwise group.\n';
  msg += 'My email is `toichi@tfwno.gf`, please don\'t sign me up for newsletters, thanks. ';
  msg += 'Once you\'ve done that, you need to let me know what the group id is for this server (I manage a lot of clients). ';
  msg += 'You can do this by navigating to the group and grabbing the numbers at the end. For example, ';
  msg += 'if the page you end up on is https://secure.splitwise.com/#/groups/1234567, your id is `1234567`. Capiche?\n';
  msg += 'Alternatively you can give me a name, and I can try to find it. Names with spaces should be `"quoted"` like so.\n';
  msg += 'Once you\'ve got that, type ' + bot.user.toString() + '` set as <your group id>`, and assuming I can find it you\'re all set.\n';
  return msg;
}

function getSetupString () {
  return 'If you need help with setting up, type ' + bot.user.toString() + '` help`.';
}

bot.login(process.env.TOKEN || credentials.discordToken);

bot.on('ready', function (event) {
  console.log('Logged in as %s - %s\n', bot.user.username, bot.user.id);
});

bot.on('guildCreate', function (guild) {
  // Just added to guild, look for channel to post intro in
  const channelRef = guild.channels.find(channel => channel.type === 'text' && channel.permissionsFor(guild.me).has('SEND_MESSAGES'));
  if (!channelRef) return; // Nowhere to send to, oh well
  let msg = 'Hey, thanks for having me! I\'m Toichi, pleasure to make your acquaintance.\n';
  msg += 'You know, they all told me *"Toichi, bulls can\'t be accountants!"*. But despite that, ';
  msg += 'here I am, working for the prestigious, uh, *' + guild.name + '* server. Living the dream eh? Anyway... \n';
  msg += getHowToText();
  msg += 'Alright, all sorted? If you ever get stuck, just type ' + bot.user.toString() + '` help`, ';
  msg += 'and I\'ll do my best to assist you.';
  channelRef.send(msg);
});

bot.on('message', async function (message) {
  if (!message.author.bot && message.guild) {
    let command = message.content.match(/[^\s"]+|"(?:[^"\\]|\\")*"/g) || []; // Help servers are useless
    command = command.map(str => {
      // Unescape quotes in the string target if it's a quoted string and trim the start and end quotes
      if (str.charAt(0) === '"' && str.charAt(str.length - 1) === '"' && str.length > 1) {
        str = str.substring(1, str.length - 1).replace(/\\"/g, '"');
      }
      return str;
    });
    console.log(command);
    if (command[0] !== bot.user.toString()) return;
    // Get some db references for later
    let groupsTable = db.getCollection('groups');
    // let clientsTable = db.getCollection('clients');
    // Parse command
    if (!command[1]) return message.channel.send('Hey, what\'s up ' + message.author.toString() + '?');
    switch (command[1]) {
      case 'set':
        let groupId = command[2] === 'as' && command[3] ? command[3] : command[2];
        if (!groupId) return message.channel.send('Please give me a group id to go look up. ' + getSetupString());
        // Now we have something to go look up.
        let groupInfo;
        try {
          groupInfo = await sw.getGroup({id: groupId});
        } catch (err) {
          console.error(err);
          return message.channel.send('Sorry, I can\'t access the group with that id. Are you sure you\'ve added me?');
        }
        if (groupInfo.id === 0) {
          // Didn't work, try a text lookup
          try {
            let groups = await sw.getGroups(); // This really shouldn't detonate
            let matchingGroups = groups.filter(group => group.name.startsWith(groupId));
            let assignedGroups = groupsTable.chain().data().map(obj => obj.groupId); // chain().data() xd
            let nonAssignedMatchingGroups = matchingGroups.filter(group => !assignedGroups.includes(group.id));
            if (nonAssignedMatchingGroups.length > 1) {
              // Too many matching groups
              return message.channel.send('Sorry, I know too many unassigned groups starting with \'' + groupId + '\'. Maybe try by id?');
            } else if (nonAssignedMatchingGroups.length === 1) {
              // Got it, assign it
              groupInfo = nonAssignedMatchingGroups[0];
            } else {
              // Nothing matches, :(
              return message.channel.send('Sorry, I couldn\'t find  any unassigned groups starting with \'' + groupId + '\'. Maybe try by id?');
            }
          } catch (err) {
            // > shouldn't
            console.error(err);
            return message.channel.send('Sorry, something went wrong when doing a lookup. Try again?');
          }
        } else {
          // Check if this group has been assigned already
          let assignedGroup = groupsTable.findOne({'groupId': groupInfo.id});
          if (assignedGroup) {
            if (assignedGroup.guildId === message.guild.id) {
              message.channel.send('This is already your server group id. The more you know eh?');
            } else {
              message.channel.send('Sorry, this group id has already been assigned to another server.');
            }
            return;
          }
        }
        // Here we should already have a workable group that is unassigned
        let groupRef = groupsTable.findOne({'guildId': message.guild.id});
        if (groupRef) {
          // Overwrite what's there
          message.channel.send('Server group id changed from ' + groupRef.groupId + ' to ' + groupInfo.id + '.');
          groupRef.groupId = groupInfo.id;
        } else {
          // Welcome to the club!
          message.channel.send('All set up! The group id for your server is ' + groupInfo.id);
          groupsTable.insert({
            guildId: message.guild.id,
            groupId: groupInfo.id
          });
        }
        db.saveDatabase();
        break;
      default:
    }
  }
});

function init (callback) {
  if (initalised) return;
  initalised = true;
  db = new Loki('./splitwise.json');

  db.loadDatabase({}, function (err) {
    if (err) {
      callback(err);
    } else {
      ['groups', 'clients'].forEach(collectionName => {
        let collection = db.getCollection(collectionName);
        if (!collection) {
          db.addCollection(collectionName);
        }
      });
      db.saveDatabase(function (err) {
        if (err) {
          callback(err);
        } else {
          console.log('Init worked, calling back.');
          callback();
        }
      });
    }
  });
};
