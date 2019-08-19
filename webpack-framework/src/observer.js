/**
 * 将data的属性变成可响应对象，为了监听变化回调
 * @param data
 * @returns {*} 第一次setData会遍历转化对象属性为可响应对象，非第一次调用则会返回data.__ob__，用此区别data是否已经转换过，避免重复遍历
 */
export function observe(data) {
    if (!data || data == undefined || typeof (data) !== "object") {
        return;
    }
    if (!data.hasOwnProperty("__ob__") || !data.__ob__ instanceof Observer) {
        new Observer(data);
        return;
    }
    return data.__ob__;
};

/**
 * 观察者，用于观察data对象属性变化
 * @param data
 * @constructor
 */
function Observer(data) {
    this.data = data;
    this.defineObProperty(data, '__ob__', this);
    this.observeData(data);
}
Observer.prototype = {
    observeData: function (data) {
        for (const key in data) {
            var value = data[key];
            if (typeof(value) == "undefined") {
                continue;
            }
            this.defineReactive(data, key, value);
            if (Array.isArray(value) || typeof(value) == "object") {
                this.observeData(value);
            }
        }
    },

    defineReactive: function (data, key, val) {
        const property = Object.getOwnPropertyDescriptor(data, key);
        if (property && property.configurable === false) {
            return
        }
        const getter = property && property.get;
        const setter = property && property.set;
        if ((!getter || setter) && arguments.length === 2) {
            val = data[key];
        }

        const dep = new DependCollector();
        const reference = this;
        Object.defineProperty(data, key, {
            enumerable: true,
            configurable: true,
            get: function reactiveGetter() {
                const value = getter ? getter.call(data) : val;
                //过滤数组的多余依赖收集
                if (Array.isArray(value) && reference.isNotSpecificScript(key)) {
                    return value;
                }
                if (DependCollector.targetWatcher) {
                    dep.depend();
                }
                return value;
            },
            set: function reactiveSetter(newVal) {
                const value = getter ? getter.call(data) : val;
                if (newVal === value || (newVal !== newVal && value !== value)) {
                    return;
                }
                if (setter) {
                    setter.call(data, newVal);
                } else {
                    val = newVal;
                }
                // 新值如果是object或数组的话，也要进行监听
                observe(newVal);
                dep.notify();
            }
        });
    },

    isNotSpecificScript: function (key) {
        return key !== Observer.currentScript;
    },
    /**
     * 被观察者data对象新增ob属性，绑定观察者，用于判断被观察者是否已经被观察
     * @param data
     * @param key
     * @param observer
     */
    defineObProperty: function (data, key, observer) {
        Object.defineProperty(data, key, {
            value: observer,
            writable: true,
            configurable: true
        })
    }
};

/**
 * 依赖收集器，收集订阅的容器，用于增减观察者队列中的观察者，并发布更新通知
 * @constructor
 */
let uid = 0;
function DependCollector() {
    this.id = uid++;
    //订阅者队列
    this.subs = {};
}
//表示当前订阅者，全局唯一的Watcher，因为在同一时间只能有一个全局的Watcher被计算
DependCollector.targetWatcher = null;
DependCollector.prototype = {

    addSub: function (sub) {
        this.subs[sub.key()] = sub;
    },

    removeSub: function (sub) {
        delete this.subs[sub.key()];
    },

    depend: function () {
        if (DependCollector.targetWatcher) {
            DependCollector.targetWatcher.addDep(this)
        }
    },

    /**
     * 通知所有订阅者，同时把当前Dep持有的所有订阅者的映射数组（id-表达式）添加到组装者中，等待组装
     */
    notify: function () {
        let formatResult = [];
        let subs = this.subs;
        for(const key in subs) {
            let sub = subs[key];
            formatResult.push(sub.format());
            sub.update()
        }
        getAssemblerSingle().addPackagingObject(formatResult);
    }
};

/**
 * 订阅者，用于响应观察者的变化
 * @constructor
 */
export function Watcher(id, script, originalScript, callBack) {
    this.id = id;
    this.script = script;
    this.originalScript = originalScript;
    this.callBack = callBack;
    this.elementId = [];
    this.depIds = [];
    this.get();
}
Watcher.prototype = {

    update: function () {
        //callBack可选，收到通知后会调用callBack回调到初始化Watcher的地方
        if (this.callBack) {
            this.callBack.call(this.id, this.elementId, this.originalScript);
        }
    },

    addDep: function (dep) {
        if (!this.depIds.hasOwnProperty(dep.id)) {
            dep.addSub(this);
            this.depIds[dep.id] = dep;
        }
        if (!this.elementId.hasOwnProperty(this.id)) {
            this.elementId.push(this.id);
        }
    },

    get: function () {
        Observer.currentScript = this.script;
        DependCollector.targetWatcher = this;
    },

    stopCollectMapping: function () {
        DependCollector.targetWatcher = null;
        Observer.currentScript = null;
    },

    format: function () {
        let obj = {};
        obj[this.id] = this.originalScript;
        return obj;
    },

    key:function(){
        return this.id.toString() + this.originalScript.toString();
    }
};

/**
 * 组装者，用于合并组装 id-属性 映射的结果，回传给原生做表达式计算和局部刷新
 * 因为表达式计算是各自独立的，所以 id-属性 映射散乱在各个Watcher中，需要在Dep层收集起来，在组装者中打平多余的层级
 * @constructor
 */
function Assembler() {
    this.packagingArray = [];
}
Assembler.prototype = {
    addPackagingObject: function (array) {
        this.packagingArray.push(array);
    },

    getNeedUpdateMapping: function () {
        let result = this.packing();
        this.packagingArray = [];
        return result;
    },
    /**
     * 组装映射关系map，打平多余的层级
     * 组装前：[[{id:表达式1}{id2:表达式2}],[{id:表达式3}]]
     * 组装后：{id:[表达式1,表达式3],{id2:[表达式2]}}
     * @returns {} 组装结果Map
     */
    packing: function () {
        let packingResult = {};
        this.packagingArray.forEach(function (array) {
            array.forEach(function (item) {
                let key = Object.keys(item)[0];
                //做一个重复id的筛选，节点id相同，则把表达式添加到该id的value数组中
                if (packingResult.hasOwnProperty(key)) {
                    packingResult[key].push(item[key]);
                } else {
                    packingResult[key] = new Array(item[key]);
                }
            });
        });
        console.log("组装映射结果:" + JSON.stringify(packingResult));
        return packingResult;
    }
};
/**
 * 获取组装者单例instance方法，全局只有一个组装者
 */
export var getAssemblerSingle = (function () {
    let instance;
    return function () {
        return instance || (instance = new Assembler())
    }
})();