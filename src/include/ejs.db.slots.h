/*
   ejs.db.slots.h -- Native property slot definitions for the "ejs.db" module
  
   This file is generated by ejsmod
  
   Slot definitions. Version 2.0.0.
 */

#ifndef _h_SLOTS_EjsDbSlots
#define _h_SLOTS_EjsDbSlots 1


/*
   Slots for the "ejs.db" module 
 */

/*
   Prototype (instance) slots for "global" type 
 */


/*
    Class property slots for the "Database" type 
 */
#define ES_ejs_db_Database_defaultDb                                   0
#define ES_ejs_db_Database_defaultDatabase                             1
#define ES_ejs_db_Database_quote                                       2
#define ES_ejs_db_Database_NUM_CLASS_PROP                              3

/*
   Prototype (instance) slots for "Database" type 
 */
#define ES_ejs_db_Database__adapter                                    0
#define ES_ejs_db_Database__connection                                 1
#define ES_ejs_db_Database__name                                       2
#define ES_ejs_db_Database__traceAll                                   3
#define ES_ejs_db_Database_addColumn                                   4
#define ES_ejs_db_Database_addIndex                                    5
#define ES_ejs_db_Database_changeColumn                                6
#define ES_ejs_db_Database_close                                       7
#define ES_ejs_db_Database_commit                                      8
#define ES_ejs_db_Database_connect                                     9
#define ES_ejs_db_Database_connection                                  10
#define ES_ejs_db_Database_createDatabase                              11
#define ES_ejs_db_Database_createTable                                 12
#define ES_ejs_db_Database_dataTypeToSqlType                           13
#define ES_ejs_db_Database_destroyDatabase                             14
#define ES_ejs_db_Database_destroyTable                                15
#define ES_ejs_db_Database_endTransaction                              16
#define ES_ejs_db_Database_getColumns                                  17
#define ES_ejs_db_Database_getTables                                   18
#define ES_ejs_db_Database_getNumRows                                  19
#define ES_ejs_db_Database_name                                        20
#define ES_ejs_db_Database_query                                       21
#define ES_ejs_db_Database_removeColumns                               22
#define ES_ejs_db_Database_removeIndex                                 23
#define ES_ejs_db_Database_renameColumn                                24
#define ES_ejs_db_Database_renameTable                                 25
#define ES_ejs_db_Database_rollback                                    26
#define ES_ejs_db_Database_sql                                         27
#define ES_ejs_db_Database_sqlTypeToDataType                           28
#define ES_ejs_db_Database_sqlTypeToEjsType                            29
#define ES_ejs_db_Database_startTransaction                            30
#define ES_ejs_db_Database_trace                                       31
#define ES_ejs_db_Database_transaction                                 32
#define ES_ejs_db_Database_NUM_INSTANCE_PROP                           33
#define ES_ejs_db_Database_NUM_INHERITED_PROP                          0

/*
    Local slots for methods in type "Database" 
 */
#define ES_ejs_db_Database_quote_str                                   0
#define ES_ejs_db_DatabaseConnector_NUM_CLASS_PROP                     0

/*
   Prototype (instance) slots for "DatabaseConnector" type 
 */
#define ES_ejs_db_DatabaseConnector_addColumn                          0
#define ES_ejs_db_DatabaseConnector_addIndex                           1
#define ES_ejs_db_DatabaseConnector_changeColumn                       2
#define ES_ejs_db_DatabaseConnector_close                              3
#define ES_ejs_db_DatabaseConnector_commit                             4
#define ES_ejs_db_DatabaseConnector_connect                            5
#define ES_ejs_db_DatabaseConnector_createDatabase                     6
#define ES_ejs_db_DatabaseConnector_createTable                        7
#define ES_ejs_db_DatabaseConnector_dataTypeToSqlType                  8
#define ES_ejs_db_DatabaseConnector_destroyDatabase                    9
#define ES_ejs_db_DatabaseConnector_destroyTable                       10
#define ES_ejs_db_DatabaseConnector_getColumns                         11
#define ES_ejs_db_DatabaseConnector_getTables                          12
#define ES_ejs_db_DatabaseConnector_removeColumns                      13
#define ES_ejs_db_DatabaseConnector_removeIndex                        14
#define ES_ejs_db_DatabaseConnector_renameColumn                       15
#define ES_ejs_db_DatabaseConnector_renameTable                        16
#define ES_ejs_db_DatabaseConnector_rollback                           17
#define ES_ejs_db_DatabaseConnector_sql                                18
#define ES_ejs_db_DatabaseConnector_sqlTypeToDataType                  19
#define ES_ejs_db_DatabaseConnector_sqlTypeToEjsType                   20
#define ES_ejs_db_DatabaseConnector_startTransaction                   21
#define ES_ejs_db_DatabaseConnector_NUM_INSTANCE_PROP                  22
#define ES_ejs_db_DatabaseConnector_NUM_INHERITED_PROP                 0

#define _ES_CHECKSUM_ejs_db   122174

#endif
