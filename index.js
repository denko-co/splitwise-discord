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

function getHelpTextIntro () {
  let msg = 'Hi, I\'m Toichi, and I\'ve been sent by the firm to help you manage your Splitwise.\n';
  msg += 'I have a lot of useful commands available, but here are the ones in your price range. 😉\n';
  msg += 'Commands are used by mentioning me, ' + bot.user.toString() + ', and then one of the following. ';
  msg += 'Parameters with spaces can be quoted `"like so"`, and quotes inside that are escaped with \\\\".\n';
  msg += '-------';
  return msg;
}

function getHelpTextCommands () {
  let msg = '`set (as) <group id | name of group>` will let me know which of my Splitwise groups belongs to you. ';
  msg += 'As you know, I need a group reference before I can do anything else.\n';
  msg += '`assign <user mention> (as) <splitwise name | id | email | phone number>` will let me know who is who ';
  msg += 'between this server and the Splitwise group set. Make sure you are searching with the details you ';
  msg += 'used for Splitwise, and the more specific the better (full names are easiest). You need to be assigned ';
  msg += 'in order to use the tip and note functionality.\n';
  msg += '`note <user mention> <note content>` sets a note for the mentioned user, and erases the old one. ';
  msg += 'Notes are useful for storing bank account details and inside jokes, ';
  msg += 'and are displayed when someone looks up the user\'s `info`.\n';
  msg += '`info` with no mention provides info for the Splitwise group - who owes who, any whiteboard info, etc.\n';
  msg += '`info <user mention>` provides info for the user (assuming they are assigned), including suggested repayments, ';
  msg += 'any notes, and their Splitwise details.\n';
  msg += '`tip <user mention> <amount> (reason)` allows you to tip an assigned user here, and have it show up on Splitwise as a debt.\n';
  msg += '-------';
  return msg;
}

function getHelpTextTransaction () {
  let msg = 'Finally, the create transaction functionality has no command keyword, as takes the form of ';
  msg += '`<list of user mentions | Splitwise details> <owe(s) | paid | paid for> <list of user mentions | Splitwise details> ';
  msg += '<total amount> (split <split values>| each) for <reason>`. Let\'s break that down:\n';
  msg += '`<list of user mentions | Splitwise details>` is a set of people involved in the transaction. ';
  msg += 'This can be either assigned users, or some details from Splitwise (such as a name), like you would with `assign`.\n';
  msg += '`<owe(s) | paid | paid for>` is just a text string, to let me know what exactly the transaction was.\n';
  msg += '`<total amount>` is the full amount involved in the transaction, assuming `each` is not specified. For example, `$3.50`\n';
  msg += 'Then, you can change how this is distributed using the following:\n';
  msg += '`split <values>` will divy up the total amount across the mentioned users. ';
  msg += 'For example, `split $10 $10 $20` for a $40 debt between 3 people. You can also say `split equally`, but this is default.\n';
  msg += '`each` tells me that the total amount is actually for each person to pay/to be paid. ';
  msg += 'For example, `@x owes @y @z $10 each` tells me that @x owes $20 all up.\n';
  msg += 'The last thing to specify is `for (reason)`, which says what the transaction was for and gives me something to put on Splitwise.\n';
  msg += 'Let\'s put everything we\'ve learnt together. Here are some sample transaction commands:\n';
  msg += '`@x @y owe @z $10 split $4 $6 for some coffee`\n';
  msg += '`"Firstname Lastname" paid @x $2 for chips`\n';
  msg += '`toichi@tfwno.gf paid for @x @y $7 each for red bull and icecream`\n';
  msg += '-------\n';
  msg += 'That\'s everything. Hope I helped.';
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
      return;
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
          'Pleasure to make your acquaintance ' + assignedReference.user.first_name + '.');
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
        await message.channel.send(getHelpTextIntro());
        await message.channel.send(getHelpTextCommands());
        await message.channel.send(getHelpTextTransaction());
        break;
      default:
        // User is probably trying to create an expense
        let group1 = [];
        let group2 = [];
        let userInfo = null;
        let modifier = null;
        let totalAmount = null;
        let isSplitting = false;
        let splitAmount = [];
        let each = false;
        let equally = false;
        let reason = null;
        for (let i = 1; i < command.length; i++) {
          let param = command[i];
          let lowerParam = param.toLowerCase();
          if (['owes', 'owe', 'paid'].includes(lowerParam)) {
            // User is specifying the bill type. Run some checks.
            if (group1.length === 0) return message.channel.send('Creating debts requires a user on the left hand side of the modifier.');
            if (modifier !== null) return message.channel.send('Mutiple modifiers are not permitted');
            if (lowerParam === 'paid') {
              if (command[i + 1] && command[i + 1].toLowerCase() === 'for') {
                // Payment (paid for)
                i++; // Skip 'for'
                modifier = {
                  paid: false,
                  ltr: false
                };
              } else {
                modifier = {
                  paid: true,
                  ltr: true
                };
              }
            } else {
              // Owes
              modifier = {
                paid: false,
                ltr: true
              };
            }
          } else if (modifier !== null && !isSplitting && (['$', '.', '-'].includes(param.charAt(0)) || param.match(/^\d/))) {
            if (group2.length === 0) return message.channel.send('Creating debts requires a user on the right hand side of the modifier.');
            if (totalAmount !== null) return message.channel.send('Mutiple total payment amounts are not permitted.');
            // Parse $$$$
            totalAmount = getCostFromString(param);
            if (totalAmount <= 0) return message.channel.send('Please specify a valid total amount of $');
          } else if (totalAmount) {
            if (lowerParam === 'for') {
              reason = originalCommand.slice(i + 1, originalCommand.length).join(' ');
              if (!reason) return message.channel.send('Reason for debt must be specified with `for`');
              break;
            } else if (lowerParam === 'each') {
              if (isSplitting) return message.channel.send('`each` can\'t be combined with a `split`');
              if (each) return message.channel.send('Can\'t stack `each`. What would that even do?');
              each = true;
            } else if (lowerParam === 'split') {
              if (each) return message.channel.send('`split` can\'t be combined with an `each`');
              if (isSplitting) return message.channel.send('Can\'t stack `split`. What would that even do?');
              isSplitting = true;
            } else if (['equally', 'equal'].includes(lowerParam)) {
              if (isSplitting && splitAmount.length > 0) return message.channel.send('Can\'t specify a way to split with `equally`');
              if (equally) return message.channel.send('Can\'t stack `equal`. What would that even do?');
              equally = true;
            } else if (isSplitting) {
              // Manage split as $ amounts
              let subsplitAmount = getCostFromString(param);
              if (subsplitAmount <= 0) return message.channel.send('Please specify a valid total amount of $ for the split.');
              splitAmount.push(subsplitAmount);
            } else {
              return message.channel.send('Command ' + param + ' not understood. See ' + bot.user.toString() + '` help` for details.');
            }
          } else {
            // First, see if this resolves to a client
            let userId;
            let userIdInfo = getClientByMention(param, groupRef.groupId);
            if (!userIdInfo.error) {
              userId = userIdInfo.client.swUser;
            } else {
              // No client, look for a sw user using assign logic
              userIdInfo = await resolveReference(param, groupInfo, userInfo);
              if (userIdInfo.error) return message.channel.send(userIdInfo.error);
              // Cache users
              userInfo = userIdInfo.userInfo;
              userId = userIdInfo.user.id;
            }
            // Ensure user hasn't been referenced before
            if (group1.concat(group2).includes(userId)) return message.channel.send('Users involved in the debt must be unique.');
            // If we're down here we have a user id, find where to push it
            if (modifier === null) {
              group1.push(userId);
            } else {
              // Check we don't have a many to many
              if (group1.length > 1 && group2.length) {
                return message.channel.send('One side of the modifier must only have one user.');
              }
              group2.push(userId);
            }
          }
        }
        // No more command to parse, ready to resolve
        if (group1.length === 0 || group2.length === 0) {
          return message.channel.send('To create a debt, two user groups and a modifier are required. ' +
            'See ' + bot.user.toString() + '` help` for details.');
        } else if (totalAmount === null) {
          return message.channel.send('To create a debt, a total $ amount is required.');
        } else if (reason === null) {
          return message.channel.send('To create a debt, a reason is required, using `for`');
        }
        // Figure out if there is a valid money split here
        // Did ya know !== works like XOR? Now you do!
        let giving = modifier.ltr !== modifier.paid ? group1 : group2;
        let receiving = modifier.ltr !== modifier.paid ? group2 : group1;
        let splitGroup = giving.length > 1 ? giving : receiving;
        if (isSplitting) {
          if (equally) {
            splitAmount = splitGroup.map(() => toFixed(totalAmount / splitGroup.length, 2));
            splitAmount[splitAmount.length - 1] = totalAmount - splitAmount.slice(0, splitAmount.length - 1).reduce((a, b) => a + b, 0);
          } else if (splitAmount.length !== splitGroup.length) {
            return message.channel.send('Please specify exactly one split amount for each user in the debt.');
          } else {
            let splitTotal = splitAmount.reduce((a, b) => a + b, 0);
            if (splitTotal !== totalAmount) return message.channel.send('Split amounts do not sum to the total amount.');
          }
        } else if (each) {
          splitAmount = splitGroup.map(() => totalAmount);
          totalAmount = totalAmount * splitGroup.length;
        } else {
          // Split equally in the same way
          splitAmount = splitGroup.map(() => toFixed(totalAmount / splitGroup.length, 2));
          splitAmount[splitAmount.length - 1] = totalAmount - splitAmount.slice(0, splitAmount.length - 1).reduce((a, b) => a + b, 0);
        }

        // Finally, after all these years, let's create a debt
        let debtObjs = [];
        // Could combine these but I feel it's more readable like this
        for (let i = 0; i < giving.length; i++) {
          debtObjs.push({
            user_id: giving[i],
            owed_share: giving === splitGroup ? splitAmount[i] : totalAmount
          });
        }

        for (let i = 0; i < receiving.length; i++) {
          debtObjs.push({
            user_id: receiving[i],
            paid_share: receiving === splitGroup ? splitAmount[i] : totalAmount
          });
        }
        let swObj = {
          description: reason,
          group_id: groupRef.groupId,
          payment: modifier.paid,
          cost: totalAmount,
          users: debtObjs
        };
        console.log(swObj);
        sw.createExpense(swObj).then(expenseInfo => {
          console.log(expenseInfo);
          message.channel.send('Transaction recorded! Images and notes can be added through Splitwise.');
        }).catch(err => {
          console.error(err);
          message.channel.send('Something went wrong when trying to add the transaction. Try again later?');
        });
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

// https://stackoverflow.com/a/23560569
function toFixed (num, precision) {
  return Number((+(Math.round(+(num + 'e' + precision)) + 'e' + -precision)).toFixed(precision));
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
