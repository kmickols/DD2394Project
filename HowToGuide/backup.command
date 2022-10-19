#!/bin/bash
today=$(date +%F)
backupdate="backup_"$today

#Create the daily folder named backup_<yyyy-mm-dd>
mkdir -m777 /Users/kristinmickols/Backup/$backupdate

#Save mongodump in daily folder
mongodump --db nodebb -o /Users/kristinmickols/Backup/$backupdate

#Save image/file uploads in daily folder
tar -czf /Users/kristinmickols/Backup/$backupdate /Users/kristinmickols/DD2394Project/nodebb/public/uploads 

#Remove files every 30 days, to change to X days set '+30' to '+X'
#Uncomment to delete automatically
#find /Users/kristinmickols/Backup/ -depth -mtime '+30' -type d -exec rm -rf -- {} \;