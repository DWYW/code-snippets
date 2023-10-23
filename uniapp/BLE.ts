function string2buffer(value: string) {
  const  reslut: number[] = []
  let i = 0;
  while(i < value.length) {
    const hex = value.charCodeAt(i++).toString(16)
    reslut.push(parseInt(hex, 16))
  }
  return new Uint8Array(reslut).buffer
}

async function delay(duration = 100, cb?: Function) {
  return new Promise((resolve) => {
    setTimeout(() => {
      cb && cb()
      resolve(undefined)
    }, duration)
  })
}

export function useBLE() { 
  async function connect (deviceId: string) {
    await uni.openBluetoothAdapter()
    await uni.createBLEConnection({ deviceId })
    if(process.env.NODE_ENV !== "production") {
      console.warn(`[${deviceId}] device connect success!`)
    }
  }
  
  async function disconnect(deviceId: string) {
    await uni.closeBLEConnection({ deviceId })
    await uni.closeBluetoothAdapter()
    
    if(process.env.NODE_ENV !== "production") {
      console.warn(`[${deviceId}] device disconnect success!`)
    }
  }
  
  /**
   * 获取可以连通的通道
   * @param {string} deviceId 
   * @param {string} msg 
   * @param {boolean} immedia 返回单个
   * @return 
  */
  async function getPipes(deviceId: string, msg: string = "hello", immedia = false) {
    // 延时获取，以防获取不到
    await delay(1000)
    const services: string[] = await uni.getBLEDeviceServices({ deviceId }).then((res) => res.services.map(item => item.uuid))
    if (services.length <= 0) {
      throw { code: 90000, message: "没有可用的服务"}
    }
    
    if(process.env.NODE_ENV !== "production") {
      console.warn(`[${deviceId}] get services success!`)
    }
    
    // 获取可能可用的notify服务
    const notificatinPipes = await getAvailableCharacteristics(deviceId, services, "notify")
    if (notificatinPipes.length <= 0) {
      throw { code: 90001, message: "没有可用的notity服务"}
    }
    
    // 获取可能可用的write服务 
    const writePipes = await getAvailableCharacteristics(deviceId, services, "write")
    if (writePipes.length <= 0) {
      throw { code: 90002, message: "没有可用的write服务"}
    }
    
    const pipes: {[K:string]: string}[] = []
    
    const listenters: Function[] = []
    uni.onBLECharacteristicValueChange((res) => {
      listenters.forEach((listener) => listener(res))
    })
    
    for (let i = 0; i < notificatinPipes.length; i++) {
      // 开启notify
      try {
        await uni.notifyBLECharacteristicValueChange({ 
          deviceId: notificatinPipes[i][0],
          serviceId: notificatinPipes[i][1],
          characteristicId: notificatinPipes[i][2],
          state: true
        })
      } catch(_) {}
    }
    
    const  tryWrite = async (i: number) => {
      listenters.pop()
      let done: null| Function = null
      const writeCallback = (res: any) => {
        done && done()
        console.log(res)
        pipes.push({
          deviceId: res.deviceId,
          notifyServiceId: res.serviceId,
          notifyCharacteristicId: res.characteristicId,
          writeServiceId: notificatinPipes[i][1],
          writeCharacteristicId: notificatinPipes[i][2]
        })
      }
      
      listenters.push(writeCallback)
      
      try {
        // 尝试延时写操作，触发notify，防止做太快
        await delay(100)
        await send(writePipes[i][0], writePipes[i][1], writePipes[i][2], string2buffer(msg))
        
        return new Promise((resolve) => {
          let timeout: null|number = null
          let _debounce: null|number = null
          done = () => {
            if (_debounce) clearTimeout(_debounce) 
            _debounce = setTimeout(() => {
              if (timeout) clearTimeout(timeout)
              resolve(undefined)
            }, 100)
          }
          
          // timeout 3s
          timeout = setTimeout(() => done && done(), 3000)
        })
      } catch(_) {}
    }
    
    for (let i = 0; i < writePipes.length; i++) {
      await tryWrite(i)
      if(immedia && pipes.length) break
    }
    
    for (let i = 0; i < notificatinPipes.length; i++) {
      // 关闭notify
      try {
        await uni.notifyBLECharacteristicValueChange({ 
          deviceId: notificatinPipes[i][0],
          serviceId: notificatinPipes[i][1],
          characteristicId: notificatinPipes[i][2],
          state: false
        })
      } catch(_) {}
    }
    
    return pipes
  }
  
  async function getAvailableCharacteristics (deviceId: string, services: string[],  type: "write"|"read"|"notify"|"indicate") {
    const res: Array<[string, string, string]> = []
    
    for(let i = 0; i < services.length; i++) {
      try {
        const { characteristics } = await uni.getBLEDeviceCharacteristics({ deviceId, serviceId: services[i] })
        const target = characteristics.find((item) => item.properties[type])
        if (target) {
          res.push([deviceId, services[i], target.uuid])
        }
      } catch(_) {}
    }
    
    return res
  }
  
  async function send(deviceId:string, serviceId: string, characteristicId: string, value: ArrayBuffer) {
    const len = value.byteLength
    // 每次只能发送20bytes
    for (let i = 0; i < len; i+=20) {
      const sub = value.slice(i, i + 20)
      await uni.writeBLECharacteristicValue({
        deviceId,
        serviceId,
        characteristicId,
        value: sub as any
      })
    }
  }
  
  return {
    connect,
    disconnect,
    getPipes,
    getAvailableCharacteristics,
    send
  }
}
