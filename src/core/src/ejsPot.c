/**
    ejsPot.c - Property Object class (Objects with properties)

    This is the base for all scripted classes.

    Copyright (c) All Rights Reserved. See details at the end of the file.
 */

/********************************** Includes **********************************/

#include    "ejs.h"

/*********************************** Defines **********************************/

#define CMP_QNAME(a,b) ((a)->name == (b)->name && (a)->space == (b)->space)
#define CMP_NAME(a,b) ((a)->name == (b)->name)

/****************************** Forward Declarations **************************/

static int  growSlots(Ejs *ejs, EjsPot *obj, int size);
static int  hashProperty(Ejs *ejs, EjsPot *obj, int slotNum, EjsName qname);
static void removeHashEntry(Ejs *ejs, EjsPot *obj, EjsName qname);

/************************************* Code ***********************************/

PUBLIC EjsAny *ejsCreateEmptyPot(Ejs *ejs)
{
    return ejsCreatePot(ejs, ESV(Object), 0);
}


PUBLIC EjsAny *ejsClonePot(Ejs *ejs, EjsAny *obj, bool deep)
{
    EjsPot      *dest, *src;
    EjsSlot     *dp, *sp;
    EjsType     *type;
    EjsObj      *vp;
    int         numProp, i;

    if (!ejsIsPot(ejs, obj)) {
        assert(ejsIsPot(ejs, obj));
        return NULL;
    }
    src = (EjsPot*) obj;
    type = TYPE(src);
    numProp = src->numProp;
    if ((dest = ejsCreatePot(ejs, type, numProp)) == 0) {
        return 0;
    }
    dest->obj = src->obj;
    dest->isBlock = src->isBlock;
    dest->isFrame = src->isFrame;
    dest->isFunction = src->isFunction;
    dest->isPrototype = src->isPrototype;
    dest->isType = src->isType;
    dest->numProp = numProp;
    dest->shortScope = src->shortScope;
    
    dp = dest->properties->slots;
    sp = src->properties->slots;

    /*
        NOTE: Object pots do not inherit prototype properties, whereas class instances do.
     */
    for (i = 0; i < numProp; i++, sp++, dp++) {
        *dp = *sp;
        dp->hashChain = -1;
        vp = sp->value.ref;
        if (deep && vp) {
            if (ejsIsFunction(ejs, vp) && !ejsIsType(ejs, vp)) {
                ;
            } else if ((ejsIsType(ejs, vp) && ((EjsType*) vp)->mutable) || 
                      (!ejsIsType(ejs, vp) && TYPE(vp)->mutableInstances)) {
#if ME_MEMORY_DEBUG
                EjsName qname = ejsGetPropertyName(ejs, src, i);
                mprSetName(dp->value.ref, qname.name->value);
#endif
                dp->value.ref = ejsClone(ejs, vp, deep);
            }
        }
    }
    if (dest->numProp > EJS_HASH_MIN_PROP) {
        ejsIndexProperties(ejs, dest);
    }
    mprCopyName(dest, src);
    return dest;
}


/*
    Fix trait type references to point to mutable types in the current interpreter. Only needed after cloning global.
 */
PUBLIC void ejsFixTraits(Ejs *ejs, EjsPot *obj)
{
    EjsSlot     *sp;
    EjsType     *type;
    int         numProp, i;

    if (VISITED(obj)) {
        return;
    }
    SET_VISITED(obj, 1);
    numProp = obj->numProp;
    sp = obj->properties->slots;
    
    for (i = 0; i < numProp; i++, sp++) {
        if (sp->trait.type && sp->trait.type->mutable) {
            assert(sp->trait.type->qname.name);
            if ((type = ejsGetPropertyByName(ejs, ejs->global, sp->trait.type->qname)) != 0) {
                sp->trait.type = type;
            } else {
                assert(0);
            }
        }
        if (ejsIsPot(ejs, sp->value.ref)) {
            ejsFixTraits(ejs, sp->value.ref);
        }
    }
    SET_VISITED(obj, 0);
}


static EjsObj *prepareAccessors(Ejs *ejs, EjsPot *obj, int slotNum, int64 *attributes, EjsObj *value)
{
    EjsFunction     *fun;
    EjsTrait        *trait;

    fun = ejsGetProperty(ejs, obj, slotNum);

    if (*attributes & EJS_TRAIT_SETTER) {
        if (ejsIsFunction(ejs, fun)) {
            /* Existing getter, add a setter */
            fun->setter = (EjsFunction*) value;
            if ((trait = ejsGetPropertyTraits(ejs, obj, slotNum)) != 0) {
                *attributes |= trait->attributes;
            }
        } else {
            /* No existing getter, must define a dummy getter - will not be called */
            fun = (EjsFunction*) ejsCloneFunction(ejs, ESV(nop), 0);
            fun->setter = (EjsFunction*) value;
        }
        value = (EjsObj*) fun;

    } else if (*attributes & EJS_TRAIT_GETTER) {
        if (ejsIsFunction(ejs, fun) && ejsPropertyHasTrait(ejs, obj, slotNum, EJS_TRAIT_SETTER)) {
            /* Existing getter and setter - preserve any defined setter, overwrite getter */
            if (fun->setter) {
                ((EjsFunction*) value)->setter = fun->setter;
                *attributes |= EJS_TRAIT_SETTER;
            }
        }
    }
    return value;
}


/*
    Define (or redefine) a property and set its name, type, attributes and property value.
 */
static int definePotProperty(Ejs *ejs, EjsPot *obj, int slotNum, EjsName qname, EjsType *propType, int64 attributes, 
    EjsObj *value)
{
    EjsFunction     *fun;
    int             priorSlot;

    assert(ejs);
    assert(ejsIsPot(ejs, obj));
    assert(slotNum >= -1);

    if (attributes & (EJS_TRAIT_GETTER | EJS_TRAIT_SETTER) && !ejsIsFunction(ejs, value)) {
        ejsThrowTypeError(ejs, "Property \"%@\" is not a function", qname.name);
        return 0;
    }
    priorSlot = ejsLookupProperty(ejs, obj, qname);
    if (slotNum < 0) {
        if (priorSlot < 0) {
            slotNum = obj->numProp;
        } else {
            slotNum = priorSlot;
        }
    }
    assert(priorSlot < 0 || priorSlot == slotNum);

    if (slotNum >= obj->numProp && !DYNAMIC(obj)) {
        if (obj->properties == 0 || slotNum >= obj->properties->size) {
            if (growSlots(ejs, obj, slotNum + 1) < 0) {
                ejsThrowMemoryError(ejs);
                return EJS_ERR;
            }
        }
        obj->numProp = slotNum + 1;
    }
    if (priorSlot < 0 && ejsSetPropertyName(ejs, obj, slotNum, qname) < 0) {
        return EJS_ERR;
    }
    if (attributes & (EJS_TRAIT_GETTER | EJS_TRAIT_SETTER)) {
        value = prepareAccessors(ejs, obj, slotNum, &attributes, value);
    }
    if (value) {
        if (ejsSetProperty(ejs, obj, slotNum, value ? value: ESV(null)) < 0) {
            return EJS_ERR;
        }
    }
    if (ejsSetPropertyTraits(ejs, obj, slotNum, propType, (int) attributes) < 0) {
        return EJS_ERR;
    }
    if (value && ejsIsFunction(ejs, value)) {
        fun = ((EjsFunction*) value);
        if (!ejsIsNativeFunction(ejs, fun) && ejsIsType(ejs, obj)) {
            ((EjsType*) obj)->hasScriptFunctions = 1;
        }
#if UNUSED
        if (fun->staticMethod && ejsIsType(ejs, obj)) {
            type = (EjsType*) obj;
            if (!type->isInterface) {
                /* For static methods, find the right base class and set thisObj to speed up later invocations */
                fun->boundThis = obj;
            }
        }
#endif
    }
    return slotNum;
}


/*
    Delete an instance property. To delete class properties, use the type as the obj. This sets the property to null.
    It does not reclaim the property slot.
 */
static int deletePotProperty(Ejs *ejs, EjsPot *obj, int slotNum)
{
    EjsName     qname;
    EjsSlot     *sp;

    assert(obj);
    assert(ejsIsPot(ejs, obj));
    assert(slotNum >= 0);

    if (slotNum < 0 || slotNum >= obj->numProp) {
        ejsThrowReferenceError(ejs, "Invalid property slot to delete");
        return EJS_ERR;
    }
    qname = ejsGetPotPropertyName(ejs, obj, slotNum);
    if (qname.name) {
        removeHashEntry(ejs, obj, qname);
    }
    sp = &obj->properties->slots[slotNum];
    sp->value.ref = ESV(undefined);
    sp->trait.type = 0;
    sp->trait.attributes = EJS_TRAIT_DELETED | EJS_TRAIT_HIDDEN;
    return 0;
}


static int deletePotPropertyByName(Ejs *ejs, EjsPot *obj, EjsName qname)
{
    int     slotNum;

    assert(ejsIsPot(ejs, obj));

    slotNum = ejsLookupPotProperty(ejs, obj, qname);
    if (slotNum < 0) {
        ejsThrowReferenceError(ejs, "Property does not exist");
        return EJS_ERR;
    }
    return deletePotProperty(ejs, obj, slotNum);
}


static EjsPot *getPotProperty(Ejs *ejs, EjsPot *obj, int slotNum)
{
    assert(ejsIsPot(ejs, obj));
    assert(obj);
    assert(slotNum >= 0);

    if (slotNum < 0 || slotNum >= obj->numProp) {
        ejsThrowReferenceError(ejs, "Property at slot \"%d\" is not found", slotNum);
        return 0;
    }
    return obj->properties->slots[slotNum].value.ref;
}


static int getPotPropertyCount(Ejs *ejs, EjsPot *obj)
{
    assert(obj);
    assert(ejsIsPot(ejs, obj));

    return obj->numProp;
}


PUBLIC EjsName ejsGetPotPropertyName(Ejs *ejs, EjsPot *obj, int slotNum)
{
    EjsName     qname;

    assert(obj);
    assert(ejsIsPot(ejs, obj));
    assert(slotNum >= 0);

    if (slotNum < 0 || slotNum >= obj->numProp) {
        qname.name = 0;
        qname.space = 0;
        return qname;
    }
    return obj->properties->slots[slotNum].qname;
}


/*
    Lookup a property with a namespace qualifier in an object and return the slot if found. Return EJS_ERR if not found.
    If qname.space is NULL, then only return a positive slot if there is only one property of the given name.
    Only the name portion is hashed. The namespace is not included in the hash. This is used to do a one-step lookup 
    for properties regardless of the namespace.
 */
PUBLIC int ejsLookupPotProperty(struct Ejs *ejs, EjsPot *obj, EjsName qname)
{
    EjsProperties   *props;
    EjsHash         *hash;
    EjsSlot         *slots, *sp, *np;
    int             slotNum, index, prior;

    assert(qname.name);
    assert(ejsIsPot(ejs, obj));

    if ((props = obj->properties) == 0 || obj->numProp == 0) {
        return -1;
    }
    slots = props->slots;
    if ((hash = props->hash) == 0 || hash->size == 0) {
        /* No hash. Just do a linear search */
        if (qname.space) {
            for (slotNum = 0; slotNum < obj->numProp; slotNum++) {
                sp = &slots[slotNum];
                if (CMP_QNAME(&sp->qname, &qname)) {
                    return slotNum;
                }
            }
            return -1;
        } else {
            for (slotNum = 0, prior = -1; slotNum < obj->numProp; slotNum++) {
                sp = &slots[slotNum];
                if (CMP_NAME(&sp->qname, &qname)) {
                    if (prior >= 0) {
                        /* Multiple properties with the same name */
                        return -1;
                    }
                    prior = slotNum;
                }
            }
            return prior;
        }

    } else {
        /*
            Find the property in the hash chain if it exists. Note the hash does not include the namespace portion.
            We assume that names rarely clash with different namespaces. We do this so variable lookup and do a one
            hash probe and find matching names. Lookup will then pick the right namespace.
         */
        assert(props->hash);
        assert(props->hash->size > 0);
        index = whash(qname.name->value, qname.name->length) % props->hash->size;
        if (qname.space) {
            assert(hash->buckets);
            assert(index < hash->size);
            for (slotNum = hash->buckets[index]; slotNum >= 0; slotNum = slots[slotNum].hashChain) {
                sp = &slots[slotNum];
                if (CMP_QNAME(&sp->qname, &qname)) {
                    return slotNum;
                }
            }
        } else {
            for (slotNum = hash->buckets[index]; slotNum >= 0; slotNum = sp->hashChain) {
                sp = &slots[slotNum];
                if (CMP_NAME(&sp->qname, &qname)) {
                    /* Now ensure there are no more matching names - must be unique in the "name" only */
                    for (np = sp; np->hashChain >= 0; ) {
                        np = &slots[np->hashChain];
                        if (CMP_NAME(&sp->qname, &np->qname)) {
                            /* Multiple properties with the same name */
                            return -1;
                        }
                    }
                    return slotNum;
                }
            }
        }
    }
    return -1;
}


/*
    Validate the supplied slot number. If set to -1, then return the next available property slot number.
    Grow the object if required and update numProp
 */
PUBLIC int ejsCheckSlot(Ejs *ejs, EjsPot *obj, int slotNum)
{
    assert(ejsIsPot(ejs, obj));

    //  TODO - should this be here or only in the VM. probably only in the VM.
    //  TODO -- or move this routine to the VM
    if (slotNum < 0 || slotNum >= obj->numProp) {
        if (!DYNAMIC(obj)) {
            if (ejsIs(ejs, obj, Null)) {
                ejsThrowReferenceError(ejs, "Object is null");
            } else if (ejsIs(ejs, obj, Void)) {
                ejsThrowReferenceError(ejs, "Object is undefined");
            } else {
                ejsThrowReferenceError(ejs, "Object is not extendable");
            }
            return EJS_ERR;
        }
        if (slotNum < 0) {
            slotNum = obj->numProp;
        }
        if (obj->properties == 0 || slotNum >= obj->properties->size) {
            if (growSlots(ejs, obj, slotNum + 1) < 0) {
                ejsThrowMemoryError(ejs);
                return EJS_ERR;
            }
        }
        if (slotNum > obj->numProp) {
            obj->numProp = slotNum;
        }
        obj->numProp++;
    }
    assert(obj->numProp <= obj->properties->size);
    return slotNum;
}


/**
    Set the value of a property.
    @param slot If slot is -1, then allocate the next free slot
    @return Return the property slot if successful. Return < 0 otherwise.
 */
static int setPotProperty(Ejs *ejs, EjsPot *obj, int slotNum, EjsObj *value)
{
    assert(ejs);
    assert(obj);
    assert(ejsIsPot(ejs, obj));
    assert(value);

    if ((slotNum = ejsCheckSlot(ejs, obj, slotNum)) < 0) {
        return EJS_ERR;
    }
    assert(slotNum < obj->numProp);
    assert(obj->numProp <= obj->properties->size);
    obj->properties->slots[slotNum].value.ref = value;
    return slotNum;
}


/*
    Set the name for a property. Objects maintain a hash lookup for property names. This is hash is created on demand 
    if there are more than N properties. If an object is not dynamic, it will use the types name hash. If dynamic, 
    then the types name hash will be copied when required. 
 */
static int setPotPropertyName(Ejs *ejs, EjsPot *obj, int slotNum, EjsName qname)
{
    EjsProperties   *props;

    assert(obj);
    assert(ejsIsPot(ejs, obj));
    assert(qname.name);
    assert(qname.space);

    if ((slotNum = ejsCheckSlot(ejs, obj, slotNum)) < 0) {
        return EJS_ERR;
    }
    assert(slotNum < obj->numProp);
    props = obj->properties;

    /* Remove the old hash entry if the name will change */
    if (props->slots[slotNum].hashChain >= 0) {
        if (CMP_QNAME(&props->slots[slotNum].qname, &qname)) {
            return slotNum;
        }
        removeHashEntry(ejs, obj, props->slots[slotNum].qname);
    }
    props->slots[slotNum].qname = qname;
    
    assert(slotNum < obj->numProp);
    assert(obj->numProp <= props->size);
    
    if (props->hash || obj->numProp > EJS_HASH_MIN_PROP) {
        if (hashProperty(ejs, obj, slotNum, qname) < 0) {
            ejsThrowMemoryError(ejs);
            return EJS_ERR;
        }
    }
    return slotNum;
}


/******************************* Slot Routines ********************************/
/*
    Grow and object and update numProp and numTraits if required
 */
PUBLIC int ejsGrowPot(Ejs *ejs, EjsPot *obj, int numProp)
{
    assert(ejsIsPot(ejs, obj));

    if (obj->properties == 0 || numProp > obj->properties->size) {
        if (growSlots(ejs, obj, numProp) < 0) {
            return EJS_ERR;
        }
    }
    if (numProp > obj->numProp) {
        obj->numProp = numProp;
    }
    return 0;
}


//  TODO-- inconsistent with growObject which takes numProp. This takes incr.
/*
    Grow the slots, traits, and names by the specified "incr". The new slots|traits|names are created at the "offset"
    Does not update numProp or numTraits.
 */
PUBLIC int ejsInsertPotProperties(Ejs *ejs, EjsPot *obj, int incr, int offset)
{
    EjsSlot         *sp, *slots;
    int             i, size, mark;

    assert(obj);
    assert(ejsIsPot(ejs, obj));
    assert(incr >= 0);

    if (incr <= 0) {
        return 0;
    }
    size = obj->numProp + incr;
    if (obj->properties == 0 || obj->properties->size < size) {
        if (growSlots(ejs, obj, size) < 0) {
            return EJS_ERR;
        }
    }
    obj->numProp += incr;
    assert(obj->numProp <= obj->properties->size);
    slots = obj->properties->slots;
    for (mark = offset + incr, i = obj->numProp - 1; i >= mark; i--) {
        sp = &slots[i - mark];
        slots[i] = *sp;
    }
    ejsZeroSlots(ejs, &slots[offset], incr);
    if (ejsIndexProperties(ejs, obj) < 0) {
        return EJS_ERR;
    }   
    return 0;
}


/*
    Allocate or grow the slots storage for an object. Does not update numProp.
 */
static int growSlots(Ejs *ejs, EjsPot *obj, int slotCount)
{
    EjsProperties   *props;
    ssize           size;
    int             factor, oldSize;

    assert(obj);
    assert(ejsIsPot(ejs, obj));
    assert(slotCount > 0);
    assert(obj->properties == 0 || slotCount > obj->properties->size);

    props = obj->properties;
    oldSize = props ? props->size : 0;
    
    if (slotCount > oldSize) {
        if (slotCount > EJS_LOTSA_PROP) {
            factor = max(oldSize / 4, EJS_ROUND_PROP);
            slotCount = (slotCount + factor) / factor * factor;
        }
        slotCount = EJS_PROP_ROUNDUP(slotCount);
        size = sizeof(EjsProperties) + (sizeof(EjsSlot) * slotCount);

        if (props == 0) {
            assert(obj->numProp == 0);
            assert(slotCount > 0);
            if ((props = mprAllocZeroed(size)) == 0) {
                return EJS_ERR;
            }
            obj->properties = props;
            ejsZeroSlots(ejs, props->slots, slotCount);
            obj->separateSlots = 1;
        } else {
            if (obj->separateSlots) {
                assert(props->size > 0);
                props = mprRealloc(props, size);
            } else {
                if ((props = mprAlloc(size)) != 0) {
                    memcpy(props, obj->properties, sizeof(EjsProperties) + obj->properties->size * sizeof(EjsSlot));
                    obj->properties = props;
                    obj->separateSlots = 1;
                }
            }
            if (props == 0) {
                return EJS_ERR;
            }
            ejsZeroSlots(ejs, &props->slots[props->size], (slotCount - props->size));
            obj->properties = props;
        }
        props->size = slotCount;
    }
    assert(obj->numProp <= props->size);
    return 0;
}


/*
    Remove a slot and name. Copy up all other properties. WARNING: this can only be used before property binding and 
    should only be used by the compiler.
 */
static void removeSlot(Ejs *ejs, EjsPot *obj, int slotNum, int compact)
{
    EjsSlot     *slots;
    int         i;

    assert(obj);
    assert(ejsIsPot(ejs, obj));
    assert(slotNum >= 0);
    assert(compact);

    if (obj->properties) {
        slots = obj->properties->slots;
        if (compact) {
            for (i = slotNum + 1; i < obj->numProp; i++) {
                slots[i - 1] = slots[i];
            }
            obj->numProp--;
            i--;
        } else {
            i = slotNum;
        }
        ejsZeroSlots(ejs, &slots[i], 1);
        ejsIndexProperties(ejs, obj);
    }
}


PUBLIC void ejsZeroSlots(Ejs *ejs, EjsSlot *slots, int count)
{
    EjsSlot     *sp;

    assert(slots);
    assert(count >= 0);

    if (slots) {
        //  TODO OPT. If hashChans were biased by +1 and NULL was allowed for names, then a simple zero would suffice.
        for (sp = &slots[count - 1]; sp >= slots; sp--) {
            sp->value.ref = ESV(null);
            sp->hashChain = -1;
            //  TODO -- why set names to this. Better to set to null?
            sp->qname.name = ESV(empty);
            sp->qname.space = ESV(empty);
            sp->trait.type = 0;
            sp->trait.attributes = 0;
        }
    }
}


PUBLIC void ejsCopySlots(Ejs *ejs, EjsPot *dest, int destOff, EjsPot *src, int srcOff, int count)
{
    EjsSlot     *sp, *dp;

    assert(dest->properties);
    assert(src->properties);
    assert(srcOff < src->numProp);
    assert(destOff < dest->numProp);

    for (sp = &src->properties->slots[srcOff], dp = &dest->properties->slots[destOff]; count > 0; count--) {
        *dp = *sp;
        dp->hashChain = -1;
        dp++;
        sp++;
    }
}


/*
    Remove a property and copy up all other properties. WARNING: This does much more than just a delete and should 
    only be used by the compiler.
 */
PUBLIC int ejsRemovePotProperty(Ejs *ejs, EjsAny *vp, int slotNum)
{
    EjsPot      *obj;

    assert(ejsIsPot(ejs, vp));

    if (!ejsIsPot(ejs, vp)) {
        ejsThrowTypeError(ejs, "Object is not configurable");
        return EJS_ERR;
    }
    obj = vp;
    assert(ejs);
    assert(obj);
    if (slotNum < 0 || slotNum >= obj->numProp) {
        return EJS_ERR;
    }
    removeSlot(ejs, obj, slotNum, 1);
    return 0;
}


/*********************************** Traits ***********************************/

static EjsTrait *getPotPropertyTraits(Ejs *ejs, EjsPot *obj, int slotNum)
{
    assert(ejsIsPot(ejs, obj));
    if (slotNum < 0 || slotNum >= obj->numProp) {
        return NULL;
    }
    return &obj->properties->slots[slotNum].trait;
}


static int setPotPropertyTraits(Ejs *ejs, EjsPot *obj, int slotNum, EjsType *type, int attributes)
{
    assert(ejsIsPot(ejs, obj));
    assert(slotNum >= 0);

    if ((slotNum = ejsCheckSlot(ejs, obj, slotNum)) < 0) {
        return EJS_ERR;
    }
    if (type) {
        obj->properties->slots[slotNum].trait.type = type;
    }
    if (attributes != -1) {
        obj->properties->slots[slotNum].trait.attributes = attributes;
    }
    return slotNum;
}


/******************************* Hash Routines ********************************/
/*
    Exponential primes
 */
static int hashSizes[] = {
     19, 29, 59, 79, 97, 193, 389, 769, 1543, 3079, 6151, 12289, 24593, 49157, 98317, 196613, 0
};


PUBLIC int ejsGetHashSize(int numProp)
{
    int     i;

    for (i = 0; hashSizes[i]; i++) {
        if (numProp < hashSizes[i]) {
            return hashSizes[i];
        }
    }
    return hashSizes[i - 1];
}


static int hashProperty(Ejs *ejs, EjsPot *obj, int slotNum, EjsName qname)
{
    EjsProperties   *props;
    EjsHash         *hash;
    EjsName         *slotName;
    EjsSlot         *slots;
    int             chainSlotNum, lastSlot, index;

    assert(ejsIsPot(ejs, obj));

    props = obj->properties;
    if (props == NULL || props->hash == NULL || props->hash->size < obj->numProp) {
        /*  Remake the entire hash */
        return ejsIndexProperties(ejs, obj);
    }
    hash = props->hash;
    slots = props->slots;
    index = whash(qname.name->value, qname.name->length) % hash->size;

    /* Scan the collision chain */
    lastSlot = -1;
    chainSlotNum = hash->buckets[index];
    assert(chainSlotNum < obj->numProp);
    assert(chainSlotNum < props->size);

    while (chainSlotNum >= 0) {
        slotName = &slots[chainSlotNum].qname;
        if (CMP_QNAME(slotName, &qname)) {
            return 0;
        }
        assert(lastSlot != chainSlotNum);
        lastSlot = chainSlotNum;
        assert(chainSlotNum != slots[chainSlotNum].hashChain);
        chainSlotNum = slots[chainSlotNum].hashChain;
        assert(0 <= lastSlot && lastSlot < props->size);
    }
    if (lastSlot >= 0) {
        assert(lastSlot < obj->numProp);
        assert(lastSlot != slotNum);
        slots[lastSlot].hashChain = slotNum;

    } else {
        /* Start a new hash chain */
        hash->buckets[index] = slotNum;
    }
    slots[slotNum].hashChain = -2;
    slots[slotNum].qname = qname;
    return 0;
}


/*
    Allocate or grow the properties storage for an object. This routine will also manage the hash index for the object. 
    If numInstanceProp is < 0, then grow the number of properties by an increment. Otherwise, set the number of properties 
    to numInstanceProp. We currently don't allow reductions.
 */
//  TODO TODO -- rename
PUBLIC int ejsIndexProperties(Ejs *ejs, EjsPot *obj)
{
    EjsSlot         *sp;
    EjsHash         *oldHash, *hash;
    int             i, newHashSize;

    assert(obj);
    assert(ejsIsPot(ejs, obj));

    if (obj->properties == 0) {
        return 0;
    }
    if (obj->numProp <= EJS_HASH_MIN_PROP && obj->properties->hash == 0) {
        /* Too few properties */
        return 0;
    }
    /*
        Reallocate the hash buckets if the hash needs to grow larger
     */
    oldHash = obj->properties->hash;
    newHashSize = ejsGetHashSize(obj->numProp);
    if (oldHash == NULL || oldHash->size < newHashSize) {
        hash = (EjsHash*) mprAlloc(sizeof(EjsHash) + (newHashSize * sizeof(int)));
        if (hash == 0) {
            return EJS_ERR;
        }
        hash->buckets = (int*) (((char*) hash) + sizeof(EjsHash));
        hash->size = newHashSize;
        assert(newHashSize > 0);
        obj->properties->hash = hash;
        obj->separateHash = 1;
    }
    hash = obj->properties->hash;
    assert(hash);
    memset(hash->buckets, -1, hash->size * sizeof(int));

    /*
        Clear out hash linkage
     */
    if (oldHash) {
        for (sp = obj->properties->slots, i = 0; i < obj->numProp; i++, sp++) {
            sp->hashChain = -1;
        }
    }

    /*
        Rehash existing properties
     */
    for (sp = obj->properties->slots, i = 0; i < obj->numProp; i++, sp++) {
        if (sp->qname.name && hashProperty(ejs, obj, i, sp->qname) < 0) {
            return EJS_ERR;
        }
    }
    return 0;
}


static void removeHashEntry(Ejs *ejs, EjsPot *obj, EjsName qname)
{
    EjsSlot     *sp;
    EjsName     *nextName;
    int         index, slotNum, lastSlot, *buckets;

    assert(ejsIsPot(ejs, obj));

    if (obj->properties->hash == 0) {
        /*
            No hash. Just do a linear search
         */
        for (slotNum = 0; slotNum < obj->numProp; slotNum++) {
            sp = &obj->properties->slots[slotNum];
            if (CMP_QNAME(&sp->qname, &qname)) {
                //  TODO -- would null be better
                sp->qname.name = ESV(empty);
                sp->qname.space = ESV(empty);
                sp->hashChain = -1;
                return;
            }
        }
        assert(0);
        return;
    }
    index = whash(qname.name->value, qname.name->length) % obj->properties->hash->size;
    slotNum = obj->properties->hash->buckets[index];
    lastSlot = -1;
    buckets = obj->properties->hash->buckets;
    while (slotNum >= 0) {
        sp = &obj->properties->slots[slotNum];
        nextName = &sp->qname;
        if (CMP_QNAME(nextName, &qname)) {
            if (lastSlot >= 0) {
                obj->properties->slots[lastSlot].hashChain = obj->properties->slots[slotNum].hashChain;
            } else {
                buckets[index] = obj->properties->slots[slotNum].hashChain;
            }
            //  TODO -- null would be better
            sp->qname.name = ESV(empty);
            sp->qname.space = ESV(empty);
            sp->hashChain = -1;
            return;
        }
        lastSlot = slotNum;
        slotNum = obj->properties->slots[slotNum].hashChain;
    }
    assert(0);
}


PUBLIC int ejsCompactPot(Ejs *ejs, EjsPot *obj)
{
    EjsSlot     *slots, *src, *dest;
    int         i, removed;

    assert(ejsIsPot(ejs, obj));

    src = dest = slots = obj->properties->slots;
    for (removed = i = 0; i < obj->numProp; i++, src++) {
        if (!ejsIsDefined(ejs, src->value.ref)) {
            removed++;
            continue;
        }
        *dest++ = *src;
    }
    obj->numProp -= removed;
    ejsIndexProperties(ejs, obj);
    return obj->numProp;
}


PUBLIC bool ejsMatchName(Ejs *ejs, EjsName *a, EjsName *b)
{
    return a->name == b->name && a->space == b->space;
}


/************************************ Factory *********************************/
/*
    Create an object which is an instance of a given type. NOTE: only initialize the Object base class. It is up to the 
    caller to complete the initialization for all other base classes by calling the appropriate constructors. The numProp 
    arg is the number of property slots to pre-allocate. It is typically zero and slots are allocated on-demand. If the 
    type creates dynamic instances, then the property slots are allocated separately and can grow. 
 */
PUBLIC void *ejsCreatePot(Ejs *ejs, EjsType *type, int numProp)
{
    EjsPot      *obj, *prototype;

    assert(type);
    
    prototype = type->prototype;
    if (type->hasInstanceVars) {
        numProp = max(numProp, prototype->numProp);
    }
    if (type->dynamicInstances) {
        if ((obj = ejsAlloc(ejs, type, 0)) == 0) {
            return 0;
        }
        if (numProp > 0) {
            growSlots(ejs, obj, numProp);
        }
        SET_DYNAMIC(obj, 1);
    } else {
        if ((obj = ejsAlloc(ejs, type, sizeof(EjsProperties) + numProp * sizeof(EjsSlot))) == 0) {
            return 0;
        }
        if (numProp > 0) {
            obj->properties = (EjsProperties*) &(((char*) obj)[type->instanceSize]);
            obj->properties->size = numProp;
        }
    }
    obj->numProp = numProp;
    if (numProp > 0) {
        if (type->hasInstanceVars) {
            if (prototype->numProp > 0) {
                ejsCopySlots(ejs, obj, 0, prototype, 0, prototype->numProp);
            }
            ejsZeroSlots(ejs, &obj->properties->slots[prototype->numProp], obj->properties->size - prototype->numProp);
            if (numProp > EJS_HASH_MIN_PROP) {
                ejsIndexProperties(ejs, obj);
            }
        } else {
            ejsZeroSlots(ejs, obj->properties->slots, obj->properties->size);
        }
    }
    ejsSetMemRef(obj);
    return obj;
}


/*
    Manage the object properties for the garbage collector
 */
PUBLIC void ejsManagePot(void *ptr, int flags)
{
    EjsSlot     *sp;
    EjsPot      *obj;
    int         i, numProp;

    if (ptr) {
        obj = (EjsPot*) ptr;

        if (flags & MPR_MANAGE_MARK) {
            if (obj->separateSlots) {
                mprMark(obj->properties);
            }
            if (obj->separateHash) {
                mprMark(obj->properties->hash);
            }
            /*
                Cache numProp incase the object grows while traversing
             */
            numProp = obj->numProp;
            for (sp = obj->properties->slots, i = 0; i < numProp; i++, sp++) {
                if (sp->qname.name) {
                    mprMark(sp->qname.name);
                    mprMark(sp->qname.space);
                    mprMark(sp->value.ref);
#if FUTURE
                    mprMark(sp->trait.type);
#endif
                }
            }
        }
    }
}


PUBLIC void ejsCreatePotHelpers(Ejs *ejs)
{
    EjsHelpers      *helpers;

    ejs->service->potHelpers = ejs->service->objHelpers;
    helpers = &ejs->service->potHelpers;
    helpers->clone                  = (EjsCloneHelper) ejsClonePot;
    helpers->create                 = (EjsCreateHelper) ejsCreatePot;
    helpers->defineProperty         = (EjsDefinePropertyHelper) definePotProperty;
    helpers->deleteProperty         = (EjsDeletePropertyHelper) deletePotProperty;
    helpers->deletePropertyByName   = (EjsDeletePropertyByNameHelper) deletePotPropertyByName;
    helpers->getProperty            = (EjsGetPropertyHelper) getPotProperty;
    helpers->getPropertyCount       = (EjsGetPropertyCountHelper) getPotPropertyCount;
    helpers->getPropertyName        = (EjsGetPropertyNameHelper) ejsGetPotPropertyName;
    helpers->getPropertyTraits      = (EjsGetPropertyTraitsHelper) getPotPropertyTraits;
    helpers->lookupProperty         = (EjsLookupPropertyHelper) ejsLookupPotProperty;
    helpers->setProperty            = (EjsSetPropertyHelper) setPotProperty;
    helpers->setPropertyName        = (EjsSetPropertyNameHelper) setPotPropertyName;
    helpers->setPropertyTraits      = (EjsSetPropertyTraitsHelper) setPotPropertyTraits;
}


/*
    @copy   default

    Copyright (c) Embedthis Software. All Rights Reserved.

    This software is distributed under commercial and open source licenses.
    You may use the Embedthis Open Source license or you may acquire a 
    commercial license from Embedthis Software. You agree to be fully bound
    by the terms of either license. Consult the LICENSE.md distributed with
    this software for full details and other copyrights.

    Local variables:
    tab-width: 4
    c-basic-offset: 4
    End:
    vim: sw=4 ts=4 expandtab

    @end
 */
