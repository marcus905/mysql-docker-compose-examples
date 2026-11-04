-- Script ripetibile per la demo web (solo ambiente didattico locale).
CREATE DATABASE IF NOT EXISTS dbwebappdb;
CREATE USER IF NOT EXISTS 'dbwebapp'@'%' IDENTIFIED WITH mysql_native_password BY 'dbwebapp';
GRANT ALL PRIVILEGES ON dbwebappdb.* TO 'dbwebapp'@'%';
