## Setup specification
* Database: Mongodb
* OS: macOS
* Backups every day at 23:59 / 11:59 pm
* Automatic deletion of old data every 30 days
* Backup of mongodump & images/files uploaded to NodeBB forum
## Requirements
* Mongodb database name "nodebb"
* Script
    * **ENSURE BACKUP DIRECTORY IS CORRECT TO AVOID DELETING IMPORTANT FILES**
    * Here backups are located in a separate backup-folder named backup, ```/Users/kristinmickols/Backup/ ```
    * For safety reasons, deletion-lines are commented out by default, please remove **#** if you want to automatically remove files
    * Default deletion interval of old data is 30 days
* Crontab setup
  * Runs script ```backup.command``` every day at 23:59. Ensure that the directory for the script is correct.

### Settings
* Update privileges to run script
```
chmod u+x /path/to/backup.command
```

* crontab -e:
```
59 23 * * /path/to/backup.command"
```

## Script
Script can be found in HowToGuide/backup.command


## Screenshots
### Enter crontab -e
![alt text](https://github.com/kmickols/DD2394Project/blob/data-loss/HowToGuide/Screenshots/crontab1.png)
### Scheduling in crontab
![alt text](https://github.com/kmickols/DD2394Project/blob/data-loss/HowToGuide/Screenshots/crontab.png)
### Backup folder
![alt text](https://github.com/kmickols/DD2394Project/blob/data-loss/HowToGuide/Screenshots/folder1.png)
### Content of backup folder
![alt text](https://github.com/kmickols/DD2394Project/blob/data-loss/HowToGuide/Screenshots/folder2.png)
