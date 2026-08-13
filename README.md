# Extension-Dice

## How to install

Install via the built-in "Download Extensions and Assets" tool. Or use a direct link:

```txt
https://github.com/SillyTavern/Extension-Dice
```

## How to use

### Via the function tool

Disabled by default. To enable, go to extension settings, find "D&D Dice" and enable the "Use function tool" option.

Requires a comptabile Chat Completion backend. See [Function Calling](https://docs.sillytavern.app/for-contributors/function-calling/) for more information.

To roll the dice, just ask for it. For example:

```txt
Roll a d20
```

#### Editing function tool rolls

Function tool rolls have an edit button next to each roller in the tool call summary. You can change the dice formula and individual die values; the total is calculated automatically. Invalid formulas, missing dice, and values outside the die range cannot be saved.

Edited rolls are marked as edited and can be restored to their original recorded values. Edits and restores apply immediately; later chat messages are kept and may still describe the previous result.

Editing updates both the displayed tool call and the structured result sent in future prompts. The original value is retained only as local chat metadata for the restore action and is not included in model context. Stored tool reasoning is preserved. The tool-call signature is also preserved when only die values change, but is cleared when the formula changes because the signature may be tied to the original arguments.

Messages can contain rolls from multiple sources. Each roll has independent edit and restore controls.

### Via the wand menu

A set of 7 classic D&amp;D dice for all your dice rolling needs. Dice rolls are just for show and are not visible in AI prompts.

1. Open the wand menu.
2. Click on the "Roll Dice" item.
3. Select the dice you want to roll, or `...` if you want to roll a custom dice.

### Via the slash command

You can also roll dice using the slash command `/roll`. For example:

```txt
/roll 1d20
```

To supress the chat message, pass a `quiet=true` argument. Then you can use the roll result passed down the pipe to the next command. For example, to echo the result of a roll without sending a message:

```txt
/roll quiet=true 1d20 | /echo
```

## License

This extension is licensed under the AGPL-3.0 license.
