const Discord = require('discord.js');
const bot = new Discord.Client({autoReconnect: true});
const Loki = require('lokijs');
const Splitwise = require('splitwise');
const credentials = require('./credentials.json');
const MAX_NOTE_LENGTH = 1000;
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
  let msg = 'Before we get started, you\'re going to have to add me to your Splitwise group.\n';
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
    let originalCommand = message.content.match(/[^\s"]+|"(?:[^"\\]|\\")*"/g) || []; // Help servers are useless
    let command = originalCommand.map(str => {
      // Unescape quotes in the string target if it's a quoted string and trim the start and end quotes
      if (str.charAt(0) === '"' && str.charAt(str.length - 1) === '"' && str.length > 1) {
        str = str.substring(1, str.length - 1).trim().replace(/\\"/g, '"');
      }
      return str;
    });
    console.log(command);
    if (command[0] !== bot.user.toString()) return;
    // Get some db references for later
    let groupsTable = db.getCollection('groups');
    let groupRef = groupsTable.findOne({'guildId': message.guild.id});
    let clientsTable = db.getCollection('clients');
    // Parse command
    if (!command[1]) return message.channel.send('Hey, what\'s up ' + message.author.toString() + '?');
    if (command[1] === 'set') {
      let groupId = command[2] === 'as' && command[3] ? command[3] : command[2];
      if (!groupId) return message.channel.send('Please give me a group id to go look up. ' + getSetupString());
      if (groupId === '0') return message.channel.send('>:(');
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
          let matchingGroups = groups.filter(group => group.name.toLowerCase().startsWith(groupId.toLowerCase()));
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
    } else {
      // If we're mentioned with some text and there's no group ref, ask them to set it. Otherwise fall through to large handler.
      if (!groupRef) {
        return message.channel.send(command[1] === 'help' ? getHowToText()
          : 'Sorry, before I can do anything, you need to set the group for this server. ' + getSetupString());
      }
    }
    // We should fetch the group info now, as we're going to be using it a lot
    let groupInfo;
    try {
      groupInfo = await sw.getGroup({id: groupRef.groupId});
    } catch (err) {
      // Splitwise has exploded
      console.error(err);
      return message.channel.send('Sorry, something went wrong when retrieving group info from Splitwise. Try again?');
    }
    switch (command[1]) {
      case 'assign':
        if (!command[2]) return message.channel.send('Please mention a Discord user you want to assign a Splitwise user to.');
        // Could be moved into its own function like getClientByMention but it's only done once so I'll leave it
        let assignedUserMention = getUserFromMention(command[2]);
        let assignedUser = message.guild.members.get(assignedUserMention);
        if (!assignedUser) {
          return message.channel.send('Sorry, I don\'t know someone called \'' + command[2] +
            '\'. Please make sure you are using a proper user mention, not a name, and make sure they\'re here!');
        }
        let assignedReferenceText = command[3] === 'as' && command[4] ? command[4] : command[3];
        if (!assignedReferenceText) {
          return message.channel.send('What on Splitwise do you want me to assign this user to? ' +
            'You can use either their full name, their phone number (with the + extension), or their email.');
        }
        let assignedReference = await resolveReference(assignedReferenceText, groupInfo, null);
        if (assignedReference.error) return message.channel.send(assignedReference.error);
        // Should store userInfo, but we aren't doing another lookup afterwards
        let assignedUserDb = clientsTable.findOne({'userId': assignedUserMention, 'groupId': groupRef.groupId});
        if (assignedUserDb) {
          if (assignedUserDb.swUser === assignedReference.user.id) {
            message.channel.send(command[2] + ' is already assigned to this user id. The more you know eh?');
          } else {
            // Rebind old user
            message.channel.send(command[2] + ' user id changed from ' + assignedUserDb.swUser + ' to ' + assignedReference.user.id + '. ' +
              'Pleasure to make your acquaintance ' + assignedReference.user.first_name + '.');
            assignedUserDb.swUser = assignedReference.user.id;
          }
        } else {
          // Make the connection (<3)
          message.channel.send(command[2] + ' assigned to user id ' + assignedReference.user.id + '. ' +
          'Pleasure to make your acquaintance ' + getSwDisplayName(assignedReference.user) + '.');
          clientsTable.insert({
            userId: assignedUserMention,
            groupId: groupRef.groupId,
            swUser: assignedReference.user.id,
            notes: '',
            tipsGiven: 0
          });
        }
        db.saveDatabase();
        break;
      case 'note':
        if (!command[2]) return message.channel.send('Please mention the user you want to add a note for.');
        let noteUserResult = getClientByMention(command[2], groupRef.groupId);
        if (noteUserResult.error) return message.channel.send(noteUserResult.error);
        let noteUser = noteUserResult.client;
        let note = originalCommand.slice(3, originalCommand.length).join(' ');
        if (note.length > MAX_NOTE_LENGTH) {
          return message.channel.send('Sorry, the maximum note length is ' + MAX_NOTE_LENGTH +
            ', and your note is ' + note.length + 'characters. Cost cutting at the firm, you know how it is.');
        }
        if (noteUser.notes) {
          message.channel.send('Note updated for user ' + command[2] + ', old note shredded.');
        } else {
          message.channel.send(note.length === 0 ? 'Note for ' + command[2] + ' is already empty.' : 'Note added for user ' + command[2] + '.');
        }
        noteUser.notes = note;
        db.saveDatabase();
        break;
      case 'tip':
        let tipGiverResult = getClientByMention(message.author.id, groupRef.groupId);
        if (tipGiverResult.error) return message.channel.send(tipGiverResult.error);
        let tipGiver = tipGiverResult.client;
        if (!command[2]) return message.channel.send('Please mention the user you want to tip.');
        let tipRecieverResult = getClientByMention(command[2], groupRef.groupId);
        if (tipRecieverResult.error) return message.channel.send(tipRecieverResult.error);
        let tipReciever = tipRecieverResult.client;
        if (tipGiver === tipReciever) return message.channel.send('You can\'t tip yourself! I won\'t allow it!');
        if (!command[3]) return message.channel.send('Please specify how much $ you want to tip ' + command[2] + '.');
        let amount = getCostFromString(command[3]);
        if (amount <= 0) return message.channel.send('Please specify a valid amount of $ to tip.');
        let tipReason = originalCommand.slice(4, originalCommand.length).join(' ');
        tipReason = tipReason.length === 0 ? '!' : ', with reason: \'' + tipReason + '\'';
        // All set.
        sw.createDebt({
          from: tipReciever.swUser,
          to: tipGiver.swUser,
          amount: amount,
          description: 'Tip from Discord' + tipReason,
          group_id: groupRef.groupId
        }).then(expenseInfo => {
          tipGiver.tipsGiven += parseFloat(expenseInfo.cost);
          message.channel.send('A generous donation. Enjoy ' + command[2] + '.');
          db.saveDatabase();
        }).catch(err => {
          console.error(err);
          message.channel.send('Something went wrong when trying to tip ' + command[2] + '. Try again later?');
        });
        break;
      case 'info':
        if (command[2]) {
          // Get info for a specific user
          let infoUserResult = getClientByMention(command[2], groupRef.groupId);
          if (infoUserResult.error) return message.channel.send(infoUserResult.error);
          let infoUser = infoUserResult.client;
          let swUser;
          try {
            swUser = await sw.getUser({id: infoUser.swUser});
          } catch (err) {
            // Can't fetch user
            console.error(err);
            return message.channel.send('Sorry, something went wrong when retrieving the info for ' + command[2] + ' from Splitwise. Try again?');
          }
          let msg = 'Info for user *' + command[2] + ':*\n';
          msg += '**Splitwise name:** ' + getSwDisplayName(swUser) + '\n';
          if (swUser.email.endsWith('@example.com')) {
            msg += '**Email address:** BLANK';
          } else if (swUser.email.endsWith('@phone.com')) {
            msg += '**Phone number:** ' + swUser.email.substring(0, swUser.email.indexOf('@phone.com'));
          } else {
            msg += '**Email address:** ' + swUser.email;
          }
          msg += '\n';
          msg += '**Notes:** ' + (infoUser.notes ? '\n' + infoUser.notes : 'BLANK') + '\n';
          msg += '**Tips given:** $' + infoUser.tipsGiven + '\n';
          let userBalance = groupInfo.members.find(member => member.id === infoUser.swUser).balance[0];
          msg += '**Balance:** $' + (userBalance ? parseFloat(userBalance.amount) : 0) + '\n';
          msg += '**Suggested repayments:**\n```diff\n';
          let debtCollection = groupInfo.simplify_by_default ? groupInfo.simplified_debts : groupInfo.original_debts;
          let filteredDebts = debtCollection.filter(debt => debt.from === infoUser.swUser || debt.to === infoUser.swUser);
          if (filteredDebts.length === 0) {
            msg += swUser.first_name + ' is all settled up';
          } else {
            let sortedDebts = filteredDebts.map(debt => {
              let otherUserId = debt.from === infoUser.swUser ? debt.to : debt.from;
              let otherUser = groupInfo.members.find(member => member.id === otherUserId);
              let amountString = debt.from === infoUser.swUser
                ? swUser.first_name + ' owes $' + debt.amount + ' to ' + getSwDisplayNameShortened(otherUser)
                : getSwDisplayNameShortened(otherUser) + ' owes $' + debt.amount + ' to ' + swUser.first_name;
              return {
                amount: debt.amount * (debt.from === infoUser.swUser ? -1 : 1),
                string: amountString,
                user: getSwDisplayName(otherUser)
              };
            }).sort((a, b) => a.amount === b.amount ? a.user.localeCompare(b.user) : b.amount - a.amount);
            sortedDebts.forEach(debt => {
              msg += (debt.amount > 0 ? '+' : '-') + ' ' + debt.string + '\n';
            });
          }
          msg += '```';
          message.channel.send(msg);
        } else {
          // Get info for the whole group
          let balanceList = groupInfo.members.map(member => {
            let amount = member.balance[0] ? parseFloat(member.balance[0].amount) : 0;
            let amountString = amount === 0 ? 'settled up' : amount > 0 ? 'gets back $' + amount : 'owes $' + Math.abs(amount);
            return {
              amount: amount,
              string: amountString,
              user: getSwDisplayName(member)
            };
          });
          balanceList.sort((a, b) => a.amount === b.amount ? a.user.localeCompare(b.user) : b.amount - a.amount);
          let groupSummary = '```diff\n';
          balanceList.forEach(balance => {
            let diffSign = balance.amount === 0 ? ' ' : balance.amount > 0 ? '+' : '-';
            groupSummary += diffSign + ' ' + balance.user + ' ' + balance.string + '\n';
          });
          groupSummary += '```';
          let msg = 'Info for group *' + groupInfo.name + '* (' + groupInfo.members.length + ' members):\n';
          msg += '**Simplify debts:** ' + (groupInfo.simplify_by_default ? 'ON' : 'OFF') + '\n';
          msg += '**Whiteboard:** ' + (groupInfo.whiteboard ? '\n' + groupInfo.whiteboard : 'BLANK') + '\n';
          msg += '**Invite link:** ' + groupInfo.invite_link + '\n';
          msg += '**Balance summary:**\n' + groupSummary;
          message.channel.send(msg);
        }
        break;
      case 'help':
        break;
      default:
        // User is probably trying to create an expense
    }
  }
});

function getCostFromString (str) {
  return Number(str.replace(/[^0-9.-]+/g, ''));
}

function getClientByMention (mention, groupId) {
  let userMention = getUserFromMention(mention);
  let user = db.getCollection('clients').findOne({'userId': userMention, 'groupId': groupId});
  return user ? {client: user, error: null } : {
    client: null,
    error: 'Sorry, I don\'t have an assigned user reference for \'' + mention +
    '\'. Please make sure you are using a proper user mention, not a name, and make sure they\'ve been assigned ' +
    'using the `assign` command.'
  };
}

function getSwDisplayName (userObj) {
  return (userObj.first_name + ' ' + (userObj.last_name || '')).trim();
}

function getSwDisplayNameShortened (userObj) {
  return (userObj.first_name + ' ' + (userObj.last_name ? userObj.last_name.charAt(0) + '.' : '')).trim();
}

async function resolveReference (reference, groupInfo, userInfo) {
  // We've be passed a reference, we have to try hunt down an id.
  // Now, the problem is that the splitwise API doesn't give you an email in group.members
  // Fetching all the emails is berry slow tho, so we are going to try to accomodate

  // First, we check id, because we have that in group.members
  let user = groupInfo.members.find(swUser => swUser.id === reference);
  if (user) return {user: user, error: null, userInfo: userInfo};

  // Then, we do a name lookup.
  let users = groupInfo.members.filter(swUser => getSwDisplayName(swUser).toLowerCase().startsWith(reference.toLowerCase()));
  if (users.length > 1) {
    // Multiple users found, nty
    return {user: null,
      error: 'Sorry, mutiple users in your group start with \'' + reference + '\', I don\'t know who to choose!',
      userInfo: userInfo
    };
  } else if (users.length === 1) {
    // Gottem
    return {user: users[0], error: null, userInfo: userInfo};
  }

  // If we're here, we got no results from the name lookup
  // Now we've exhausted name and id, go and fetch all of them for a filter
  if (!userInfo) {
    userInfo = await Promise.all(groupInfo.members.map(member => sw.getUser({id: member.id})));
  }

  // Run the email filter on userInfo
  user = userInfo.find(swUser => swUser.email === reference || swUser.email === reference + '@phone.com'); // gj Splitwise
  const defaultError = 'Sorry, I couldn\'t find a user with the reference \'' + reference + '\' in your group.';
  return user ? {user: user, error: null, userInfo: userInfo} : {user: null, error: defaultError, userInfo: userInfo};
}

function getUserFromMention (mention) {
  return mention.replace(/[<@!>]/g, '');
}

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
